// @ts-check

import { EntityDamageCause, EquipmentSlot } from "@minecraft/server";
import { destroyExplosionTerrain } from "./controlled_destruction.js";
import { javaExplosionDamage } from "./java_explosion_math.js";
import { isEntityUsable } from "./safe.js";
import { isLocationLoaded } from "./world_bounds.js";
import { add, distance, normalize, scale, subtract } from "./vector.js";


function enchantmentLevel(item, ids) {
  if (!item) return 0;
  try {
    const enchantable = item.getComponent("minecraft:enchantable");
    if (!enchantable) return 0;
    for (const id of ids) {
      try {
        const enchantment = enchantable.getEnchantment(id);
        if (enchantment) return Math.max(0, enchantment.level ?? 0);
      } catch {
        // Try the alternate namespaced/non-namespaced identifier.
      }
    }
  } catch {
    // Items without the component have no relevant protection.
  }
  return 0;
}

function javaMitigatedExplosionDamage(entity, rawDamage) {
  let armor = 0;
  let toughness = 0;
  let protectionPoints = 0;
  try {
    const equippable = entity.getComponent("minecraft:equippable");
    if (equippable) {
      armor = Math.max(0, Number(equippable.totalArmor) || 0);
      toughness = Math.max(0, Number(equippable.totalToughness) || 0);
      for (const slot of [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet]) {
        const item = equippable.getEquipment(slot);
        protectionPoints += enchantmentLevel(item, ["minecraft:protection", "protection"]);
        protectionPoints += enchantmentLevel(item, ["minecraft:blast_protection", "blast_protection"]) * 2;
      }
    }
  } catch {
    armor = 0;
    toughness = 0;
    protectionPoints = 0;
  }

  const effectiveArmor = Math.min(
    20,
    Math.max(armor / 5, armor - rawDamage / (2 + toughness / 4))
  );
  let damage = rawDamage * (1 - effectiveArmor / 25);
  damage *= 1 - Math.min(20, protectionPoints) / 25;

  try {
    const resistance = entity.getEffect("resistance");
    if (resistance) {
      damage *= Math.max(0, 1 - Math.min(4, (resistance.amplifier ?? 0) + 1) * 0.2);
    }
  } catch {
    // Effect inspection is optional for non-living or unloaded entities.
  }
  return Math.max(0, damage);
}

function applyExplosionDamage(entity, rawAmount, source) {
  const isPlayer = entity.typeId === "minecraft:player";
  if (isPlayer) {
    // Scripted entityExplosion damage has differed across Bedrock revisions in
    // how armor/toughness is applied. Calculate the Java result explicitly and
    // use override so a point-blank comet does not accidentally apply the raw
    // pre-armor value to a fully equipped player. Totems and hurt events still
    // pass through Entity.applyDamage.
    const finalAmount = javaMitigatedExplosionDamage(entity, rawAmount);
    if (finalAmount <= 0) return false;
    return entity.applyDamage(finalAmount, {
      cause: EntityDamageCause.override,
      ...(isEntityUsable(source) ? { damagingEntity: source } : {})
    }) === true;
  }
  return entity.applyDamage(rawAmount, {
    cause: EntityDamageCause.entityExplosion,
    ...(isEntityUsable(source) ? { damagingEntity: source } : {})
  }) === true;
}

function entityCenter(entity) {
  try {
    const box = entity.getAABB();
    if (box?.center) return { ...box.center };
  } catch {
    // Fall through to head/base approximations for unsupported entities.
  }
  try {
    return entity.getHeadLocation();
  } catch {
    return { x: entity.location.x, y: entity.location.y + 0.9, z: entity.location.z };
  }
}

function entitySamplePoints(entity) {
  try {
    const box = entity.getAABB();
    const center = box?.center;
    const extent = box?.extent;
    if (center && extent) {
      const fractions = [-0.9, 0, 0.9];
      const points = [];
      for (const fx of fractions) {
        for (const fy of fractions) {
          for (const fz of fractions) {
            points.push({
              x: center.x + extent.x * fx,
              y: center.y + extent.y * fy,
              z: center.z + extent.z * fz
            });
          }
        }
      }
      return points;
    }
  } catch {
    // Older/limited entities use a conservative 3x3x3 fallback box.
  }
  const center = entityCenter(entity);
  const points = [];
  for (const x of [-0.3, 0, 0.3]) {
    for (const y of [-0.75, 0, 0.75]) {
      for (const z of [-0.3, 0, 0.3]) points.push(add(center, { x, y, z }));
    }
  }
  return points;
}

function sampleIsExposed(dimension, center, sample) {
  const delta = subtract(sample, center);
  const length = distance(center, sample);
  if (length < 0.001) return true;
  try {
    const hit = dimension.getBlockFromRay(center, normalize(delta), {
      maxDistance: Math.max(0.01, length - 0.05),
      includeLiquidBlocks: false,
      includePassableBlocks: false
    });
    return !hit?.block;
  } catch {
    return false;
  }
}

function sampledExposure(dimension, center, target) {
  const points = entitySamplePoints(target);
  if (points.length === 0) return 0;
  let clear = 0;
  for (const point of points) {
    if (sampleIsExposed(dimension, center, point)) clear += 1;
  }
  return clear / points.length;
}

export { javaExplosionDamage } from "./java_explosion_math.js";

export function applyJavaExplosion({
  dimension,
  center,
  power,
  source,
  breaksBlocks = true,
  maxDestroyedBlocks = 96,
  visualParticle = "bomd:gauntlet_smoke",
  excludedTypeIds = []
}) {
  if (power <= 0 || !isLocationLoaded(dimension, center)) return { damaged: 0, destroyed: 0 };
  const radius = power * 2;
  const excluded = new Set(excludedTypeIds);
  let damaged = 0;
  let destroyed = 0;

  let entities = [];
  try {
    entities = dimension.getEntities({ location: center, maxDistance: radius + 1 });
  } catch {
    entities = [];
  }

  for (const entity of entities) {
    if (
      !isEntityUsable(entity) ||
      entity.id === source?.id ||
      entity.typeId === "bomd:gauntlet_hitbox_proxy" ||
      excluded.has(entity.typeId)
    ) continue;
    let health;
    try {
      health = entity.getComponent("minecraft:health");
    } catch {
      continue;
    }
    if (!health) continue;
    const targetCenter = entityCenter(entity);
    const targetDistance = distance(center, targetCenter);
    const exposure = sampledExposure(dimension, center, entity);
    const amount = javaExplosionDamage(power, targetDistance, exposure);
    if (amount <= 0) continue;
    let applied = false;
    try {
      applied = applyExplosionDamage(entity, amount, source);
    } catch {
      applied = false;
    }
    if (!applied) continue;
    damaged += 1;
    const direction = normalize(subtract(targetCenter, center));
    const impact = Math.max(0, (1 - targetDistance / radius) * exposure);
    try {
      entity.applyImpulse(add(scale(direction, impact * 1.15), { x: 0, y: impact * 0.18, z: 0 }));
    } catch {
      // Some entities do not accept scripted impulses.
    }
  }

  if (breaksBlocks) {
    destroyed = destroyExplosionTerrain(dimension, center, power, maxDestroyedBlocks);
  }

  try {
    dimension.spawnParticle(visualParticle, center);
    dimension.spawnParticle("bomd:gauntlet_spark", center);
    dimension.playSound("random.explode", center, { volume: Math.min(2.2, 0.65 + power * 0.28), pitch: Math.max(0.55, 1.05 - power * 0.07) });
  } catch {
    // Visual/audio failures must not alter logical explosion results.
  }
  return { damaged, destroyed };
}
