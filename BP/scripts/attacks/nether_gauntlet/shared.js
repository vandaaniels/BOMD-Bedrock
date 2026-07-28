// @ts-check

import { EntityDamageCause } from "@minecraft/server";
import { destroyBossBlocksInBox } from "../../core/controlled_destruction.js";
import {
  GAUNTLET_CHARGE_ACTIVE_SPEED,
  GAUNTLET_CHARGE_SUPPORT_MAX_IMPULSE,
  GAUNTLET_CHARGE_SUPPORT_RESPONSE,
  GAUNTLET_CHARGE_WINDUP_SPEED,
  GAUNTLET_HURT_COOLDOWN_TICKS,
  GAUNTLET_WINDUP_UPWARD_SPEED
} from "../../core/gauntlet_config.js";
import { recordCombatEvent } from "../../core/combat_debug.js";
import { scaleBossDamage, scaleBossMovement } from "../../core/difficulty.js";
import { isEntityUsable, attempt } from "../../core/safe.js";
import { sweptFistHitsPlayer } from "../../core/swept_collision.js";
import { add, distance, normalize, scale, subtract } from "../../core/vector.js";


export function gauntletContextActive(context, requireTarget = true) {
  return context.isCurrent() && isEntityUsable(context.boss) && (!requireTarget || isEntityUsable(context.target));
}

export function gauntletEyeOrigin(boss) {
  const forward = normalize(boss.getViewDirection());
  return add({ x: boss.location.x, y: boss.location.y + 1.6, z: boss.location.z }, scale(forward, 0.45));
}

export function applyGauntletWindupLift(boss) {
  // PunchAction and SwirlPunchAction call addVelocity(0, 0.7, 0) in Java.
  // Bedrock's no-gravity solver produces substantially more vertical travel
  // from the literal value, so GAUNTLET_WINDUP_UPWARD_SPEED is the measured
  // engine-conversion impulse rather than a raw copy.
  const upwardImpulse = scaleBossMovement(GAUNTLET_WINDUP_UPWARD_SPEED);
  attempt(
    () => boss.applyImpulse({ x: 0, y: upwardImpulse, z: 0 }),
    "apply Java Gauntlet wind-up lift"
  );
}

export function accelerateToward(boss, targetPoint, amount) {
  const direction = normalize(subtract(targetPoint, gauntletEyeOrigin(boss)));
  const velocity = attempt(() => boss.getVelocity(), "read Gauntlet acceleration velocity") ?? { x: 0, y: 0, z: 0 };
  const forwardSpeed = velocity.x * direction.x + velocity.y * direction.y + velocity.z * direction.z;
  const lateral = {
    x: velocity.x - direction.x * forwardSpeed,
    y: velocity.y - direction.y * forwardSpeed,
    z: velocity.z - direction.z * forwardSpeed
  };
  const scaledAmount = scaleBossMovement(amount);
  attempt(() => boss.applyImpulse({
    x: (direction.x - lateral.x) * scaledAmount,
    y: (direction.y - lateral.y) * scaledAmount,
    z: (direction.z - lateral.z) * scaledAmount
  }), "accelerate Gauntlet toward attack target");
}

export function attackTargetStillFar(boss, targetPoint, minimumDistance = 3) {
  return distance(boss.location, targetPoint) >= minimumDistance;
}

/**
 * Stores the immutable direction selected when the attack begins. Java keeps
 * targetPos fixed for PunchAction; this vector is therefore never recalculated
 * from the player's later position.
 */
export function lockGauntletCharge(context) {
  const { boss, attackData } = context;
  attackData.lockedDirection = normalize(
    subtract(attackData.targetPoint, gauntletEyeOrigin(boss))
  );
  attackData.chargePassedTarget = false;
}

/**
 * Replaces the weak background VelocityGoal that runs concurrently with
 * PunchAction in Java. The 1.4.0 rewrite stopped all movement except the three
 * scheduled impulses, so the charge lost nearly all speed between them. This
 * support only maintains speed along the locked vector; it cannot follow a
 * player who dodges after commitment.
 */
export function maintainLockedGauntletChargePhase(context, active) {
  if (!gauntletContextActive(context, false)) return;
  const { boss, attackData } = context;
  if (attackData.chargePassedTarget === true) return;
  const locked = attackData.lockedDirection;
  const targetPoint = attackData.targetPoint;
  if (!locked || !targetPoint) return;

  const remaining = subtract(targetPoint, gauntletEyeOrigin(boss));
  const remainingAlongPath =
    remaining.x * locked.x + remaining.y * locked.y + remaining.z * locked.z;
  if (remainingAlongPath <= 0.35) {
    attackData.chargePassedTarget = true;
    attackData.active = false;
    return;
  }

  const desiredSpeed = active
    ? GAUNTLET_CHARGE_ACTIVE_SPEED
    : GAUNTLET_CHARGE_WINDUP_SPEED;
  const velocity = attempt(
    () => boss.getVelocity(),
    "read hybrid locked Gauntlet velocity"
  ) ?? { x: 0, y: 0, z: 0 };
  const forwardSpeed =
    velocity.x * locked.x + velocity.y * locked.y + velocity.z * locked.z;
  if (forwardSpeed >= desiredSpeed) return;
  const magnitude = Math.min(
    GAUNTLET_CHARGE_SUPPORT_MAX_IMPULSE,
    Math.max(0, desiredSpeed - forwardSpeed) * GAUNTLET_CHARGE_SUPPORT_RESPONSE
  );
  if (magnitude <= 0) return;
  attempt(
    () => boss.applyImpulse(scale(locked, magnitude)),
    "maintain hybrid locked Gauntlet charge"
  );
}

export function primeSweptCollision(context) {
  context.attackData.previousCollisionLocation = { ...context.boss.location };
  context.attackData.previousImpactVelocity = attempt(
    () => context.boss.getVelocity(),
    "prime Gauntlet swept velocity"
  ) ?? { x: 0, y: 0, z: 0 };
}

export function advanceSweptCollision(context) {
  if (!gauntletContextActive(context, false)) return;
  context.attackData.previousCollisionLocation = { ...context.boss.location };
  context.attackData.previousImpactVelocity = attempt(
    () => context.boss.getVelocity(),
    "advance Gauntlet swept velocity"
  ) ?? context.attackData.previousImpactVelocity ?? { x: 0, y: 0, z: 0 };
}

/**
 * Resolves the closed fist as a swept 2x2x2 box. This prevents fast punches
 * from tunnelling through a player between two manager ticks.
 */
export function hitPlayersSwept(context, damage, hitMemory, localTick = 0) {
  const { boss, attackData } = context;
  const previous = attackData.previousCollisionLocation ?? { ...boss.location };
  const current = { ...boss.location };
  const velocity = attempt(() => boss.getVelocity(), "read swept Gauntlet impact velocity") ?? { x: 0, y: 0, z: 0 };
  const travel = distance(previous, current);
  const midpoint = {
    x: (previous.x + current.x) * 0.5,
    y: (previous.y + current.y) * 0.5 + 1,
    z: (previous.z + current.z) * 0.5
  };
  const scaledDamage = scaleBossDamage(damage);
  const players = attempt(
    () => boss.dimension.getPlayers({ location: midpoint, maxDistance: travel * 0.5 + 5 }),
    "query swept Gauntlet collision players"
  ) ?? [];

  for (const player of players) {
    // Java checks the overlapping entity every tick; vanilla hurt immunity
    // determines whether a later hit is valid. Mirror that with a tick-based
    // cooldown instead of forbidding all subsequent hits during the charge.
    const lastHitTick = hitMemory.get(player.id) ?? -999;
    if (localTick - lastHitTick < GAUNTLET_HURT_COOLDOWN_TICKS) continue;
    const fraction = sweptFistHitsPlayer(previous, current, player.location);
    if (!Number.isFinite(fraction)) continue;
    let applied = scaledDamage <= 0;
    if (scaledDamage > 0) {
      applied = attempt(
        () => player.applyDamage(scaledDamage, {
          damagingEntity: boss,
          cause: EntityDamageCause.entityAttack
        }),
        "Gauntlet swept collision damage"
      ) === true;
    }
    if (!applied) continue;
    hitMemory.set(player.id, localTick);
    recordCombatEvent("gauntlet_swept_hit", {
      bossId: boss.id,
      playerId: player.id,
      localTick,
      fraction,
      previous,
      current,
      velocity
    });
    // Java transfers half of the Gauntlet's current velocity to the target.
    attempt(
      () => player.applyImpulse({ x: velocity.x * 0.5, y: velocity.y * 0.5, z: velocity.z * 0.5 }),
      "Gauntlet swept velocity transfer"
    );
  }

  attackData.previousCollisionLocation = current;
  attackData.previousImpactVelocity = velocity;
}

export function destroyPunchPreparationBlocks(boss) {
  const forward = normalize(boss.getViewDirection());
  const center = {
    x: Math.floor(boss.location.x + forward.x),
    y: Math.floor(boss.location.y + forward.y),
    z: Math.floor(boss.location.z + forward.z)
  };
  return destroyBossBlocksInBox(
    boss.dimension,
    { x: center.x - 1, y: center.y - 1, z: center.z - 1 },
    { x: center.x + 1, y: center.y + 2, z: center.z + 1 },
    "explosion",
    36
  );
}

export function forwardBlockHit(boss, maxDistance = 2.3) {
  const origin = { x: boss.location.x, y: boss.location.y + 1.0, z: boss.location.z };
  const velocity = attempt(() => boss.getVelocity(), "read Gauntlet collision direction") ?? boss.getViewDirection();
  const direction = normalize(Math.hypot(velocity.x, velocity.y, velocity.z) > 0.05 ? velocity : boss.getViewDirection());
  return attempt(() => boss.dimension.getBlockFromRay(origin, direction, {
    maxDistance,
    includeLiquidBlocks: false,
    includePassableBlocks: false
  }), "raycast Gauntlet collision");
}
