// @ts-check

import { EntityDamageCause, world } from "@minecraft/server";
import { profileDamage } from "./balance.js";
import { isBossCombatPlayer } from "./combat_target.js";
import { attempt, isEntityUsable } from "./safe.js";
import { distance, normalize, subtract } from "./vector.js";

const PROTECTED_BLOCKS = new Set([
  "minecraft:air",
  "minecraft:bedrock",
  "minecraft:barrier",
  "minecraft:command_block",
  "minecraft:chain_command_block",
  "minecraft:repeating_command_block",
  "minecraft:end_portal",
  "minecraft:end_portal_frame",
  "minecraft:end_gateway",
  "minecraft:structure_block",
  "minecraft:jigsaw",
  "bomd:sealed_blackstone",
  "bomd:gauntlet_blackstone"
]);

export function canGauntletBreakBlock(block) {
  return Boolean(
    block &&
      !block.isAir &&
      !PROTECTED_BLOCKS.has(block.typeId)
  );
}

export function destroyGauntletBox(dimension, center, halfSize, limit = 96) {
  if (!world.gameRules.mobGriefing) return 0;

  // Avoid scanning every block in a potentially large explosion cube in one
  // tick. Build a cheap coordinate list, inspect nearest blocks first, and cap
  // native block reads. Damage/knockback range is unchanged; this only bounds
  // environmental destruction work for the watchdog.
  const scanHalfSize = {
    x: Math.min(5.5, Math.max(0, halfSize.x)),
    y: Math.min(5.5, Math.max(0, halfSize.y)),
    z: Math.min(5.5, Math.max(0, halfSize.z))
  };
  const coordinates = [];
  for (let x = Math.floor(center.x - scanHalfSize.x); x <= Math.floor(center.x + scanHalfSize.x); x += 1) {
    for (let y = Math.floor(center.y - scanHalfSize.y); y <= Math.floor(center.y + scanHalfSize.y); y += 1) {
      for (let z = Math.floor(center.z - scanHalfSize.z); z <= Math.floor(center.z + scanHalfSize.z); z += 1) {
        const dx = x + 0.5 - center.x;
        const dy = y + 0.5 - center.y;
        const dz = z + 0.5 - center.z;
        coordinates.push({ x, y, z, distanceSquared: dx * dx + dy * dy + dz * dz });
      }
    }
  }
  coordinates.sort((left, right) => left.distanceSquared - right.distanceSquared);

  const inspectionLimit = Math.min(coordinates.length, Math.max(192, Math.min(768, limit * 8)));
  let broken = 0;
  for (let index = 0; index < inspectionLimit && broken < limit; index += 1) {
    const position = coordinates[index];
    const block = attempt(
      () => dimension.getBlock(position),
      "read Nether Gauntlet destructible block"
    );
    if (!canGauntletBreakBlock(block)) continue;
    if (attempt(() => block.setType("minecraft:air"), "break Nether Gauntlet collision block") !== undefined) {
      broken += 1;
    }
  }
  return broken;
}

export function destroyGauntletRayBlock(blockHit) {
  if (!world.gameRules.mobGriefing || !canGauntletBreakBlock(blockHit?.block)) {
    return false;
  }
  return attempt(
    () => blockHit.block.setType("minecraft:air"),
    "perforate block with Nether Gauntlet laser"
  ) !== undefined;
}

function exposureToPlayer(dimension, origin, player) {
  const center = attempt(
    () => player.getHeadLocation(),
    "read explosion target center"
  ) ?? { ...player.location, y: player.location.y + 1 };
  const delta = subtract(center, origin);
  const rayDistance = distance(center, origin);
  if (rayDistance < 0.2) {
    return 1;
  }
  const hit = attempt(
    () => dimension.getBlockFromRay(origin, normalize(delta), {
      maxDistance: Math.max(0.1, rayDistance - 0.25),
      includeLiquidBlocks: false,
      includePassableBlocks: false
    }),
    "measure Nether Gauntlet explosion exposure"
  );
  return hit ? 0.35 : 1;
}

export function javaExplosionDamage(power, distanceFromCenter, exposure = 1) {
  const reach = power * 2;
  const impact = Math.max(0, 1 - distanceFromCenter / Math.max(0.001, reach));
  const exposedImpact = impact * Math.max(0, Math.min(1, exposure));
  return Math.floor(
    ((exposedImpact * exposedImpact + exposedImpact) * 0.5) *
      7 *
      reach +
      1
  );
}

export function resolveCalculatedExplosion(
  boss,
  location,
  power,
  { balancedScale = 0.76, balancedCap = 48, destroyRadius = power } = {}
) {
  if (!isEntityUsable(boss)) {
    return;
  }
  const dimension = boss.dimension;
  attempt(
    () => dimension.playSound("random.explode", location, {
      volume: Math.min(3, 0.8 + power * 0.35),
      pitch: 0.86
    }),
    "play calculated Nether Gauntlet explosion"
  );
  attempt(
    () => dimension.spawnParticle("minecraft:huge_explosion_emitter", location),
    "show calculated Nether Gauntlet explosion"
  );
  const players = attempt(
    () => dimension.getPlayers({ location, maxDistance: power * 2 }),
    "query calculated explosion victims"
  ) ?? [];
  for (const player of players.filter(isBossCombatPlayer)) {
    const separation = distance(location, player.location);
    const exposure = exposureToPlayer(dimension, location, player);
    const javaDamage = javaExplosionDamage(power, separation, exposure);
    const damage = profileDamage(
      javaDamage,
      Math.min(balancedCap, Math.max(1, Math.round(javaDamage * balancedScale)))
    );
    if (damage <= 0) {
      continue;
    }
    attempt(
      () => player.applyDamage(damage, {
        cause: EntityDamageCause.entityExplosion,
        damagingEntity: boss
      }),
      "apply calculated Nether Gauntlet explosion damage"
    );
    const direction = normalize(subtract(player.location, location));
    const impact = Math.max(0, 1 - separation / Math.max(0.001, power * 2));
    attempt(
      () => player.applyImpulse({
        x: direction.x * impact * exposure * 0.85,
        y: Math.max(0.18, impact * exposure * 0.55),
        z: direction.z * impact * exposure * 0.85
      }),
      "apply calculated Nether Gauntlet explosion knockback"
    );
  }
  destroyGauntletBox(
    dimension,
    location,
    { x: destroyRadius, y: destroyRadius, z: destroyRadius },
    Math.max(24, Math.round(power * power * 7))
  );
}
