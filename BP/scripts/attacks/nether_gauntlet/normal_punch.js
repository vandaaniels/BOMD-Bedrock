// @ts-check

import {
  GAUNTLET_DAMAGE,
  GAUNTLET_NORMAL_PUNCH_EXPLOSION_MULTIPLIER
} from "../../core/gauntlet_config.js";
import { applyJavaExplosion } from "../../core/java_explosion.js";
import { attempt } from "../../core/safe.js";
import { playGauntletSound } from "../../visuals/nether_gauntlet.js";
import {
  accelerateToward,
  applyGauntletWindupLift,
  advanceSweptCollision,
  attackTargetStillFar,
  destroyPunchPreparationBlocks,
  forwardBlockHit,
  gauntletContextActive,
  gauntletEyeOrigin,
  hitPlayersSwept,
  lockGauntletCharge,
  maintainLockedGauntletChargePhase,
  primeSweptCollision
} from "./shared.js";

function activePunchTick(context, localTick) {
  if (!gauntletContextActive(context, false)) return;
  const { boss, attackData } = context;
  hitPlayersSwept(context, GAUNTLET_DAMAGE.punch, attackData.hitMemory, localTick);

  const velocity = attempt(() => boss.getVelocity(), "read Gauntlet punch impact speed") ?? { x: 0, y: 0, z: 0 };
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const previousVelocity = attackData.previousSpeedVelocity ?? attackData.previousImpactVelocity ?? velocity;
  const previousSpeed = Math.hypot(previousVelocity.x, previousVelocity.y, previousVelocity.z);
  const hitWall = forwardBlockHit(boss, Math.max(1.35, previousSpeed * 1.6))?.block;
  const abruptStop = previousSpeed > 0.55 && speed < previousSpeed * 0.42;
  if (!attackData.collided && previousSpeed > 0.55 && (hitWall || abruptStop)) {
    attackData.collided = true;
    applyJavaExplosion({
      dimension: boss.dimension,
      center: { x: boss.location.x, y: boss.location.y + 1.0, z: boss.location.z },
      power: previousSpeed * GAUNTLET_NORMAL_PUNCH_EXPLOSION_MULTIPLIER,
      source: boss,
      breaksBlocks: true,
      maxDestroyedBlocks: 42
    });
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

export const normalPunch = {
  id: "punch",
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
    attackData.collided = false;
    attackData.active = false;
    attackData.opened = false;
    attackData.previousSpeedVelocity = attempt(() => boss.getVelocity(), "read initial Gauntlet punch velocity") ?? { x: 0, y: 0, z: 0 };
    primeSweptCollision(context);
    destroyPunchPreparationBlocks(boss);
    attempt(() => boss.lookAt(attackData.targetPoint), "aim Gauntlet punch");
  },
  pulse(context, pulse) {
    if (!gauntletContextActive(context, false)) return;
    switch (pulse) {
      case "begin":
        applyGauntletWindupLift(context.boss);
        break;
      case "clink":
        playGauntletSound(context.boss.dimension, "bomd.nether_gauntlet.hurt", context.boss.location, 1.25, 0.78);
        break;
      case "impulse_1":
        scheduledImpulse(context, 0.60);
        break;
      case "impulse_2":
      case "impulse_3":
        scheduledImpulse(context, 0.32);
        break;
      case "open":
        context.attackData.active = false;
        context.attackData.opened = true;
        break;
    }
  },
  tick(context, localTick) {
    if (!gauntletContextActive(context, false)) return;
    maintainLockedGauntletChargePhase(context, context.attackData.active === true);
    if (context.attackData.active === true) activePunchTick(context, localTick);
    else advanceSweptCollision(context);
  }
};
