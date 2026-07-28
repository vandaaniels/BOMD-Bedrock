// @ts-check

import {
  GAUNTLET_DAMAGE,
  GAUNTLET_ENERGIZED_EXPLOSION_POWER,
  GAUNTLET_NORMAL_PUNCH_EXPLOSION_MULTIPLIER,
  GAUNTLET_SPARK_PARTICLE
} from "../../core/gauntlet_config.js";
import { applyJavaExplosion } from "../../core/java_explosion.js";
import { attempt } from "../../core/safe.js";
import { playGauntletSound, spawnGauntletRing } from "../../visuals/nether_gauntlet.js";
import {
  accelerateToward,
  applyGauntletWindupLift,
  advanceSweptCollision,
  attackTargetStillFar,
  forwardBlockHit,
  gauntletContextActive,
  gauntletEyeOrigin,
  hitPlayersSwept,
  lockGauntletCharge,
  maintainLockedGauntletChargePhase,
  primeSweptCollision
} from "./shared.js";

function spinActive(context, localTick) {
  if (!gauntletContextActive(context, false)) return;
  const { boss, attackData } = context;
  hitPlayersSwept(context, GAUNTLET_DAMAGE.swirlPunch, attackData.hitMemory, localTick);
  if (localTick % 4 === 0) spawnGauntletRing(boss.dimension, boss.location, 3.0, GAUNTLET_SPARK_PARTICLE, 6);

  const velocity = attempt(() => boss.getVelocity(), "read Gauntlet swirl impact speed") ?? { x: 0, y: 0, z: 0 };
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const previousVelocity = attackData.previousSpeedVelocity ?? attackData.previousImpactVelocity ?? velocity;
  const previousSpeed = Math.hypot(previousVelocity.x, previousVelocity.y, previousVelocity.z);
  const hitWall = forwardBlockHit(boss, Math.max(1.4, previousSpeed * 1.7))?.block;
  const abruptStop = previousSpeed > 0.55 && speed < previousSpeed * 0.42;
  const canExplode = localTick - (attackData.lastExplosionTick ?? -999) >= 5;
  if (canExplode && previousSpeed > 0.55 && (hitWall || abruptStop)) {
    const energized = attackData.energized === true;
    applyJavaExplosion({
      dimension: boss.dimension,
      center: { x: boss.location.x, y: boss.location.y + 1.0, z: boss.location.z },
      power: energized ? GAUNTLET_ENERGIZED_EXPLOSION_POWER : previousSpeed * GAUNTLET_NORMAL_PUNCH_EXPLOSION_MULTIPLIER,
      source: boss,
      breaksBlocks: true,
      maxDestroyedBlocks: energized ? 96 : 42
    });
    attackData.lastExplosionTick = localTick;
    attackData.energized = false;
  }
  attackData.previousSpeedVelocity = velocity;
}

function scheduledImpulse(context, amount) {
  const { boss, attackData } = context;
  if (attackData.chargePassedTarget === true) return;
  if (!attackTargetStillFar(boss, attackData.targetPoint, 3)) return;
  attackData.active = true;
  accelerateToward(boss, attackData.targetPoint, amount);
}

export const spinPunch = {
  id: "swirl_punch",
  duration: 80,
  execute(context) {
    const { boss, target, attackData } = context;
    if (!gauntletContextActive(context)) return;
    const eye = gauntletEyeOrigin(boss);
    attackData.targetPoint = {
      x: eye.x + (target.location.x - eye.x) * 1.2,
      y: eye.y + (target.location.y + 0.9 - eye.y) * 1.2,
      z: eye.z + (target.location.z - eye.z) * 1.2
    };
    lockGauntletCharge(context);
    attackData.hitMemory = new Map();
    attackData.energized = true;
    attackData.active = false;
    attackData.opened = false;
    attackData.lastExplosionTick = -999;
    attackData.previousSpeedVelocity = attempt(() => boss.getVelocity(), "read initial Gauntlet swirl velocity") ?? { x: 0, y: 0, z: 0 };
    primeSweptCollision(context);
    attempt(() => boss.lookAt(attackData.targetPoint), "aim Gauntlet swirl punch");
  },
  pulse(context, pulse) {
    if (!gauntletContextActive(context, false)) return;
    switch (pulse) {
      case "begin":
        applyGauntletWindupLift(context.boss);
        playGauntletSound(context.boss.dimension, "bomd.nether_gauntlet.spin_punch", context.boss.location, 1.5, 1.0);
        break;
      case "impulse_1":
        scheduledImpulse(context, 0.60);
        break;
      case "impulse_2":
        scheduledImpulse(context, 0.40);
        break;
      case "open":
        context.attackData.active = false;
        context.attackData.opened = true;
        context.attackData.energized = false;
        break;
    }
  },
  tick(context, localTick) {
    if (!gauntletContextActive(context, false)) return;
    maintainLockedGauntletChargePhase(context, context.attackData.active === true);
    if (context.attackData.active === true) spinActive(context, localTick);
    else advanceSweptCollision(context);
  }
};
