// @ts-check

import {
  EntityDamageCause,
  system,
  world
} from "@minecraft/server";
import {
  BOSS_TYPE,
  COMET_EXPLOSION_POWER,
  COMET_TYPE,
  FROST_PARTICLE,
  LICH_PHANTOM_TYPE,
  MAGIC_MISSILE_DAMAGE,
  MAGIC_MISSILE_TYPE,
  MINION_TAG,
  SOUL_FLAME_PARTICLE
} from "../core/config.js";
import { scaleBossDamage, scaleBossEffectTicks, scaleBossExplosionPower, scaleVisualCount } from "../core/difficulty.js";
import { recordCombatEvent } from "../core/combat_debug.js";
import { applyJavaExplosion } from "../core/java_explosion.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import { normalize } from "../core/vector.js";
import { playSound, spawnBurst } from "../visuals/frost.js";

const resolvedProjectileIds = new Set();
let registered = false;

function markResolved(projectile) {
  const id = attempt(() => projectile.id, "read projectile id");
  if (!id || resolvedProjectileIds.has(id)) return false;
  resolvedProjectileIds.add(id);
  system.runTimeout(() => resolvedProjectileIds.delete(id), 20);
  return true;
}

function projectileOwner(projectile) {
  return attempt(
    () => projectile?.getComponent("minecraft:projectile")?.owner,
    "read Night Lich projectile owner"
  );
}

function isLichAlly(entity) {
  if (!isEntityUsable(entity)) return false;
  if (
    entity.typeId === BOSS_TYPE ||
    entity.typeId === LICH_PHANTOM_TYPE
  ) return true;
  return attempt(() => entity.hasTag(MINION_TAG), "read Lich minion tag") === true;
}

function isExemptEntity(event, victim) {
  if (!isEntityUsable(victim)) return false;
  if (isLichAlly(victim)) return true;
  const sourceId = attempt(() => event.source?.id, "read projectile source id");
  return sourceId !== undefined && victim.id === sourceId;
}

function resolveMissile(event, victim) {
  const { dimension, location, projectile } = event;
  spawnBurst(dimension, location, scaleVisualCount(12), 0.45, FROST_PARTICLE);

  if (!isEntityUsable(victim)) {
    playSound(dimension, "dig.basalt", location, 1, 1);
    return;
  }
  const victimHealth = attempt(
    () => victim.getComponent("minecraft:health"),
    "read missile victim health"
  );
  if (!victimHealth) return;

  const source = isEntityUsable(event.source) ? event.source : undefined;
  const missileDamage = scaleBossDamage(MAGIC_MISSILE_DAMAGE);
  if (missileDamage <= 0) return;
  if (isEntityUsable(projectile)) {
    attempt(
      () => victim.applyDamage(missileDamage, {
        damagingEntity: source,
        damagingProjectile: projectile
      }),
      "magic missile projectile damage"
    );
  } else {
    attempt(
      () => victim.applyDamage(missileDamage, {
        damagingEntity: source,
        cause: EntityDamageCause.magic
      }),
      "magic missile fallback damage"
    );
  }
  attempt(
    () => victim.addEffect("slowness", scaleBossEffectTicks(100), {
      amplifier: 2,
      showParticles: true
    }),
    "magic missile slowness"
  );
}

export function detonateNightLichComet(projectile, location, source, reason = "collision") {
  if (!isEntityUsable(projectile) || !markResolved(projectile)) return false;
  const dimension = projectile.dimension;
  const center = location ?? { ...projectile.location };
  const owner = isEntityUsable(source) ? source : projectileOwner(projectile);

  spawnBurst(dimension, center, scaleVisualCount(54), 2.4, SOUL_FLAME_PARTICLE);
  spawnBurst(dimension, center, scaleVisualCount(34), 1.3, FROST_PARTICLE);
  const explosionPower = scaleBossExplosionPower(COMET_EXPLOSION_POWER);
  if (explosionPower > 0) {
    applyJavaExplosion({
      dimension,
      center,
      power: explosionPower,
      source: isEntityUsable(owner) ? owner : undefined,
      breaksBlocks: world.gameRules.mobGriefing,
      maxDestroyedBlocks: 84,
      visualParticle: SOUL_FLAME_PARTICLE,
      excludedTypeIds: [LICH_PHANTOM_TYPE]
    });
  }
  recordCombatEvent("comet_detonated", {
    projectileId: projectile.id,
    reason,
    location: center,
    sourceId: owner?.id
  });
  attempt(() => projectile.remove(), "remove detonated Night Lich comet");
  return true;
}

function collisionSurfaceLocation(event, victim) {
  const location = { ...event.location };
  // Bedrock may invalidate the projectile before projectileHitEntity is
  // dispatched. In that case the event location is still authoritative and
  // reading velocity only creates a noisy InvalidEntityError.
  if (!isEntityUsable(event.projectile)) return location;
  const velocity = attempt(
    () => event.projectile.getVelocity(),
    "read Night Lich projectile impact velocity"
  );
  if (!velocity) return location;
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  if (speed < 0.01) return location;
  const direction = normalize(velocity);
  // Bedrock can report an entity projectile hit from inside the victim AABB.
  // Move the explosion back to the contacted surface so the distance/exposure
  // calculation does not treat every direct comet hit as center-point damage.
  const backstep = isEntityUsable(victim) ? 0.42 : 0.16;
  return {
    x: location.x - direction.x * backstep,
    y: location.y - direction.y * backstep,
    z: location.z - direction.z * backstep
  };
}

function resolve(event, victim) {
  const typeId = attempt(() => event.projectile.typeId, "read projectile type");
  if (typeId !== MAGIC_MISSILE_TYPE && typeId !== COMET_TYPE) return;
  if (isExemptEntity(event, victim)) return;

  if (typeId === COMET_TYPE) {
    detonateNightLichComet(
      event.projectile,
      collisionSurfaceLocation(event, victim),
      event.source,
      "collision"
    );
    return;
  }

  if (!markResolved(event.projectile)) return;
  try {
    resolveMissile(event, victim);
  } finally {
    if (isEntityUsable(event.projectile)) {
      attempt(() => event.projectile.remove(), "remove resolved Night Lich projectile");
    }
  }
}

function interceptCometDamage(event) {
  const comet = event.hurtEntity;
  if (comet.typeId !== COMET_TYPE) return;

  const direct = event.damageSource.damagingEntity;
  const damagingProjectile = event.damageSource.damagingProjectile;
  const projectileSource = projectileOwner(damagingProjectile);
  if (isLichAlly(direct) || isLichAlly(projectileSource)) {
    event.cancel = true;
    return;
  }

  event.cancel = true;
  const location = { ...comet.location };
  const owner = projectileOwner(comet);
  system.run(() => {
    detonateNightLichComet(comet, location, owner, "intercepted");
  });
}

export function registerProjectileEvents() {
  if (registered) return;
  registered = true;

  world.beforeEvents.entityHurt.subscribe((event) => {
    attempt(() => interceptCometDamage(event), "intercept Night Lich comet damage");
  });
  world.afterEvents.projectileHitEntity.subscribe((event) => {
    const victim = attempt(
      () => event.getEntityHit().entity,
      "resolve projectile entity hit"
    );
    if (isEntityUsable(victim) && victim.typeId === COMET_TYPE) {
      const attacker = projectileOwner(event.projectile);
      if (!isLichAlly(attacker)) {
        const owner = projectileOwner(victim);
        attempt(
          () => detonateNightLichComet(victim, { ...victim.location }, owner, "intercepted_projectile"),
          "intercept Night Lich comet with projectile"
        );
      }
      return;
    }
    attempt(() => resolve(event, victim), "handle Night Lich entity projectile");
  });
  world.afterEvents.projectileHitBlock.subscribe((event) => {
    attempt(() => resolve(event, undefined), "handle Night Lich block projectile");
  });
}
