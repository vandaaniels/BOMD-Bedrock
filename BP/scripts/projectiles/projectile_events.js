// @ts-check

import {
  EntityDamageCause,
  system,
  world
} from "@minecraft/server";
import {
  CHARGED_PEARL_ROD_PARTICLE,
  CHARGED_ENDER_PEARL_TYPE,
  CHARGED_PEARL_OWNER_PROPERTY,
  BOSS_TYPE,
  COMET_BALANCED_POWER,
  COMET_EXPLOSION_POWER,
  COMET_TYPE,
  FROST_PARTICLE,
  LICH_PHANTOM_TYPE,
  MAGIC_MISSILE_DAMAGE,
  MAGIC_MISSILE_TYPE,
  SOUL_FLAME_PARTICLE,
  VOID_ATTACK_DAMAGE,
  VOID_BLADE_TYPE,
  VOID_BLOSSOM_HITBOX_TYPE,
  VOID_BLOSSOM_TYPE,
  VOID_PETAL_PARTICLE,
  VOID_SPORE_IMPACT_PARTICLE,
  VOID_SPORE_PARTICLE,
  VOID_SPORE_TYPE
} from "../core/config.js";
import { usesBalancedScaling } from "../core/balance.js";
import { isBossCombatPlayer } from "../core/combat_target.js";
import { resolveCalculatedExplosion } from "../core/explosion.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import { horizontalDistance, normalize, subtract } from "../core/vector.js";
import { playSound, spawnBurst, spawnParticle } from "../visuals/frost.js";

const resolvedProjectileIds = new Set();
let registered = false;

function markResolved(projectile) {
  const id = attempt(() => projectile.id, "read projectile id");
  if (!id || resolvedProjectileIds.has(id)) {
    return false;
  }

  resolvedProjectileIds.add(id);
  system.runTimeout(() => resolvedProjectileIds.delete(id), 20);
  return true;
}

function isExemptEntity(event, victim) {
  if (!isEntityUsable(victim)) {
    return false;
  }
  if (
    victim.typeId === "minecraft:phantom" ||
    victim.typeId === LICH_PHANTOM_TYPE
  ) {
    return true;
  }

  const sourceId = attempt(
    () => event.source?.id,
    "read projectile source id"
  );
  const sourceTypeId = attempt(
    () => event.source?.typeId,
    "read projectile source type"
  );
  if (
    victim.typeId === "minecraft:player" &&
    !isBossCombatPlayer(victim) &&
    (sourceTypeId === BOSS_TYPE || sourceTypeId === VOID_BLOSSOM_TYPE)
  ) {
    return true;
  }
  if (
    victim.typeId === VOID_BLOSSOM_HITBOX_TYPE &&
    sourceTypeId === VOID_BLOSSOM_TYPE
  ) {
    return true;
  }
  return sourceId !== undefined && victim.id === sourceId;
}

function resolveMissile(event, victim) {
  const { dimension, location, projectile } = event;
  spawnBurst(dimension, location, 12, 0.45, FROST_PARTICLE);

  if (!isEntityUsable(victim)) {
    playSound(dimension, "dig.basalt", location, 1, 1);
    return;
  }
  const victimHealth = attempt(
    () => victim.getComponent("minecraft:health"),
    "read missile victim health"
  );
  if (!victimHealth) {
    return;
  }

  const source = isEntityUsable(event.source)
    ? event.source
    : undefined;
  if (isEntityUsable(projectile)) {
    attempt(
      () =>
        victim.applyDamage(MAGIC_MISSILE_DAMAGE, {
          damagingEntity: source,
          damagingProjectile: projectile
        }),
      "magic missile projectile damage"
    );
  } else {
    attempt(
      () =>
        victim.applyDamage(MAGIC_MISSILE_DAMAGE, {
          damagingEntity: source,
          cause: EntityDamageCause.magic
        }),
      "magic missile fallback damage"
    );
  }
  attempt(
    () =>
      victim.addEffect("slowness", 100, {
        amplifier: 2,
        showParticles: true
      }),
    "magic missile slowness"
  );
}

function resolveComet(event, victim) {
  const { dimension, location, source } = event;
  spawnBurst(dimension, location, 54, 2.4, SOUL_FLAME_PARTICLE);
  spawnBurst(dimension, location, 34, 1.3, FROST_PARTICLE);
  if (isEntityUsable(source)) {
    const power = usesBalancedScaling()
      ? COMET_BALANCED_POWER
      : COMET_EXPLOSION_POWER;
    resolveCalculatedExplosion(source, location, power, {
      balancedScale: 0.78,
      balancedCap: 44,
      destroyRadius: usesBalancedScaling() ? 1.8 : COMET_EXPLOSION_POWER
    });
  }
}

function resolveVoidBlade(event, victim) {
  const { dimension, location, projectile } = event;
  spawnBurst(dimension, location, 7, 0.28, VOID_PETAL_PARTICLE);
  if (!isEntityUsable(victim) || victim.typeId === VOID_BLOSSOM_TYPE) return;
  const source = isEntityUsable(event.source) ? event.source : undefined;
  if (isEntityUsable(projectile)) {
    attempt(
      () => victim.applyDamage(VOID_ATTACK_DAMAGE, {
        damagingEntity: source,
        damagingProjectile: projectile
      }),
      "Void Blossom petal blade projectile damage"
    );
  } else {
    attempt(
      () => victim.applyDamage(VOID_ATTACK_DAMAGE, {
        cause: EntityDamageCause.entityAttack,
        damagingEntity: source
      }),
      "Void Blossom petal blade fallback damage"
    );
  }
}

function resolveVoidSpore(event) {
  const { dimension } = event;
  const location = { ...event.location };
  const sourceId = isEntityUsable(event.source) ? event.source.id : undefined;
  playSound(dimension, "bomd.void_blossom.spore_impact", location, 1.4, 0.9);
  spawnParticle(dimension, VOID_SPORE_IMPACT_PARTICLE, {
    x: location.x,
    y: location.y + 0.35,
    z: location.z
  });
  for (let delay = 0; delay < 30; delay += 5) {
    system.runTimeout(() => {
      for (let index = 0; index < 18; index += 1) {
        const angle = (Math.PI * 2 * index) / 18;
        const radius = 7 * Math.sqrt((index + 0.5) / 18);
        spawnParticle(dimension, VOID_SPORE_PARTICLE, {
          x: location.x + Math.cos(angle) * radius,
          y: location.y + 0.15 + (index % 3) * 0.18,
          z: location.z + Math.sin(angle) * radius
        });
      }
    }, Math.max(1, delay));
  }
  system.runTimeout(() => {
    const source = sourceId ? attempt(
      () => world.getEntity(sourceId),
      "resolve Void Blossom spore owner"
    ) : undefined;
    const players = attempt(
      () => dimension.getPlayers({ location, maxDistance: 8 }),
      "query Void Blossom spore victims"
    ) ?? [];
    for (const player of players.filter(isBossCombatPlayer)) {
      if (
        horizontalDistance(player.location, location) > 7.35 ||
        Math.abs(player.location.y - location.y) > 4
      ) continue;
      attempt(
        () => player.applyDamage(VOID_ATTACK_DAMAGE, {
          cause: EntityDamageCause.magic,
          damagingEntity: isEntityUsable(source) ? source : undefined
        }),
        "Void Blossom spore damage"
      );
      attempt(
        () => player.addEffect("poison", 140, {
          amplifier: 0,
          showParticles: true
        }),
        "Void Blossom spore poison"
      );
    }
    spawnBurst(dimension, location, 32, 4.8, VOID_SPORE_PARTICLE);
  }, 30);
}

function safePearlDestination(dimension, location, travelDirection) {
  const direction = normalize(travelDirection);
  for (const retreat of [0.8, 1.25, 1.75, 0]) {
    const base = {
      x: location.x - direction.x * retreat,
      y: location.y - direction.y * retreat,
      z: location.z - direction.z * retreat
    };
    for (const yOffset of [0, 1, 2, 3, -1]) {
      const candidate = {
        x: Math.floor(base.x) + 0.5,
        y: Math.floor(base.y + yOffset),
        z: Math.floor(base.z) + 0.5
      };
      const feet = attempt(
        () => dimension.getBlock(candidate),
        "read charged Ender Pearl feet block"
      );
      const head = attempt(
        () => dimension.getBlock({
          x: candidate.x,
          y: candidate.y + 1,
          z: candidate.z
        }),
        "read charged Ender Pearl head block"
      );
      if (feet?.isAir && head?.isAir) return candidate;
    }
  }
  return { x: location.x, y: location.y + 1, z: location.z };
}

function chargedPearlOwner(event) {
  if (
    isEntityUsable(event.source) &&
    event.source.typeId === "minecraft:player"
  ) {
    return event.source;
  }
  const componentOwner = attempt(
    () => event.projectile
      ?.getComponent("minecraft:projectile")
      ?.owner,
    "read charged Ender Pearl component owner"
  );
  if (
    isEntityUsable(componentOwner) &&
    componentOwner.typeId === "minecraft:player"
  ) {
    return componentOwner;
  }
  const ownerId = attempt(
    () => event.projectile?.getDynamicProperty(
      CHARGED_PEARL_OWNER_PROPERTY
    ),
    "read charged Ender Pearl stored owner"
  );
  const storedOwner = typeof ownerId === "string"
    ? attempt(
      () => world.getEntity(ownerId),
      "resolve charged Ender Pearl stored owner"
    )
    : undefined;
  return isEntityUsable(storedOwner) &&
    storedOwner.typeId === "minecraft:player"
    ? storedOwner
    : undefined;
}

function resolveChargedPearl(event) {
  const player = chargedPearlOwner(event);
  if (!isEntityUsable(player)) return;
  const velocity = attempt(
    () => event.projectile?.getVelocity(),
    "read charged Ender Pearl impact velocity"
  ) ?? event.hitVector ?? player.getViewDirection();
  const destination = safePearlDestination(
    event.dimension,
    event.location,
    velocity
  );
  attempt(
    () => player.teleport(destination, { dimension: event.dimension }),
    "teleport charged Ender Pearl user"
  );
  attempt(
    () => player.addEffect("resistance", 120, {
      amplifier: 1,
      showParticles: true
    }),
    "charged Ender Pearl resistance"
  );
  attempt(
    () => player.addEffect("slow_falling", 20, {
      amplifier: 0,
      showParticles: false
    }),
    "charged Ender Pearl slow falling"
  );
  const nearby = attempt(
    () => event.dimension.getEntities({ location: destination, maxDistance: 3.5 }),
    "query charged Ender Pearl repulsion"
  ) ?? [];
  for (const entity of nearby) {
    if (!isEntityUsable(entity) || entity.id === player.id) continue;
    const direction = normalize(subtract(entity.location, destination));
    attempt(
      () => entity.applyImpulse({
        x: direction.x * 0.95,
        y: 0.32,
        z: direction.z * 0.95
      }),
      "charged Ender Pearl repulsion"
    );
  }
  spawnBurst(event.dimension, destination, 28, 1.7, VOID_PETAL_PARTICLE);
  spawnParticle(event.dimension, CHARGED_PEARL_ROD_PARTICLE, {
    x: destination.x,
    y: destination.y + 0.1,
    z: destination.z
  });
  playSound(event.dimension, "mob.endermen.portal", destination, 1.2, 0.82);
}

function resolve(event, victim) {
  const typeId = attempt(() => event.projectile.typeId, "read projectile type");
  if (
    typeId !== MAGIC_MISSILE_TYPE &&
    typeId !== COMET_TYPE &&
    typeId !== VOID_SPORE_TYPE &&
    typeId !== VOID_BLADE_TYPE &&
    typeId !== CHARGED_ENDER_PEARL_TYPE
  ) {
    return;
  }
  if (isExemptEntity(event, victim)) {
    return;
  }
  if (!markResolved(event.projectile)) {
    return;
  }

  try {
    if (typeId === MAGIC_MISSILE_TYPE) {
      resolveMissile(event, victim);
    } else if (typeId === COMET_TYPE) {
      resolveComet(event, victim);
    } else if (typeId === VOID_SPORE_TYPE) {
      resolveVoidSpore(event);
    } else if (typeId === VOID_BLADE_TYPE) {
      resolveVoidBlade(event, victim);
    } else {
      resolveChargedPearl(event);
    }
  } finally {
    if (isEntityUsable(event.projectile)) {
      attempt(
        () => event.projectile.remove(),
        "remove resolved Night Lich projectile"
      );
    }
  }
}

export function registerProjectileEvents() {
  if (registered) {
    return;
  }
  registered = true;

  world.afterEvents.projectileHitEntity.subscribe((event) => {
    const victim = attempt(
      () => event.getEntityHit().entity,
      "resolve projectile entity hit"
    );
    attempt(
      () => resolve(event, victim),
      "handle Night Lich entity projectile"
    );
  });
  world.afterEvents.projectileHitBlock.subscribe((event) => {
    attempt(
      () => resolve(event, undefined),
      "handle Night Lich block projectile"
    );
  });
}
