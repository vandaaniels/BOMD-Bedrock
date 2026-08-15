// @ts-check

import {
  GAUNTLET_ANIMATION_STATE,
  GAUNTLET_NORMAL_EXPLOSION_MULTIPLIER,
  GAUNTLET_NORMAL_PUNCH_DAMAGE
} from "../../core/config.js";
import {
  destroyGauntletBox,
  resolveCalculatedExplosion
} from "../../core/explosion.js";
import { usesBalancedScaling } from "../../core/balance.js";
import { attempt } from "../../core/safe.js";
import { distance, length, normalize, scale, subtract } from "../../core/vector.js";
import { playSound } from "../../visuals/frost.js";
import {
  spawnGauntletImpact,
  spawnGauntletRing
} from "../../visuals/gauntlet.js";
import {
  combatPlayers,
  damagePlayer,
  gauntletSweepsPlayer,
  gauntletSpeed,
  predictTargetCenter,
  setGauntletAnimation,
  setGauntletDashPhysics,
  setGauntletDesiredVelocity,
  setGauntletEnergy,
  setGauntletEyeOpen,
  setGauntletHandClosed,
  transferGauntletVelocity
} from "./shared.js";

const WINDUP_TICKS = 13;
const MAX_CHARGE_TICKS = 38;
const RECOVERY_TICKS = 13;
const CHARGE_SPEED = 0.62;

function centerOfBossAt(location) {
  return { x: location.x, y: location.y + 1.15, z: location.z };
}

function predictedDrivePoint(boss, target, leadTicks = 6) {
  const targetPoint = predictTargetCenter(target, leadTicks, 0.8, 3.8);
  const origin = centerOfBossAt(boss.location);
  const delta = subtract(targetPoint, origin);
  return {
    x: origin.x + delta.x * 1.08,
    y: origin.y + delta.y * 1.08,
    z: origin.z + delta.z * 1.08
  };
}

function traceChargeWall(boss, previousLocation, desiredDirection) {
  const from = centerOfBossAt(previousLocation);
  const to = centerOfBossAt(boss.location);
  let delta = subtract(to, from);
  let travelled = length(delta);
  if (travelled < 0.03) {
    delta = desiredDirection;
    travelled = 0;
  }
  const direction = normalize(delta);
  const horizontal = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
  const right = horizontal > 0.001
    ? { x: direction.z / horizontal, y: 0, z: -direction.x / horizontal }
    : { x: 1, y: 0, z: 0 };
  for (const side of [-0.62, 0, 0.62]) {
    for (const height of [-0.55, 0.25, 0.85]) {
      const origin = {
        x: from.x + right.x * side,
        y: from.y + height,
        z: from.z + right.z * side
      };
      const hit = attempt(
        () => boss.dimension.getBlockFromRay(origin, direction, {
          maxDistance: travelled + 1.05,
          includeLiquidBlocks: false,
          includePassableBlocks: false
        }),
        "trace scripted Nether Gauntlet punch wall"
      );
      if (hit) return hit;
    }
  }
  return undefined;
}

function beginRecovery(context, reason) {
  const { boss, state, now } = context;
  const data = state.attackData;
  if (data.phase === "recovery") return;
  data.phase = "recovery";
  data.phaseStartTick = now;
  data.recoveryReason = reason;
  setGauntletDashPhysics(boss, false);
  setGauntletDesiredVelocity(boss, { x: 0, y: 0, z: 0 }, 0.72);
  setGauntletAnimation(boss, GAUNTLET_ANIMATION_STATE.punchStop);
  setGauntletEnergy(boss, 0);
  setGauntletEyeOpen(boss, true);
  setGauntletHandClosed(boss, false);
}

function resolveWallImpact(context) {
  const { boss, state } = context;
  const data = state.attackData;
  const impactSpeed = Math.max(data.previousSpeed ?? 0, gauntletSpeed(boss), CHARGE_SPEED);
  const javaPower = Math.max(0.9, impactSpeed * GAUNTLET_NORMAL_EXPLOSION_MULTIPLIER);
  const power = usesBalancedScaling() ? Math.min(2.1, javaPower) : javaPower;
  attempt(() => boss.teleport(data.previousLocation), "rollback Nether Gauntlet from wall impact");
  attempt(() => boss.clearVelocity(), "stop Nether Gauntlet at wall impact");
  spawnGauntletImpact(boss.dimension, boss.location, 28);
  spawnGauntletRing(
    boss.dimension,
    { ...boss.location, y: boss.location.y + 0.15 },
    Math.max(2.5, power * 1.35),
    32
  );
  resolveCalculatedExplosion(boss, boss.location, power, {
    balancedScale: 0.82,
    balancedCap: 24,
    destroyRadius: usesBalancedScaling() ? 1.4 : power
  });
  playSound(boss.dimension, "random.explode", boss.location, 1.1, 0.92);
  beginRecovery(context, "wall");
}

function resolvePlayerImpact(context, player) {
  const { boss, state } = context;
  const data = state.attackData;
  if (data.hitPlayer) return;
  data.hitPlayer = true;
  damagePlayer(player, boss, GAUNTLET_NORMAL_PUNCH_DAMAGE, "damage with scripted Nether Gauntlet punch");
  const impactVelocity = data.previousVelocity ?? boss.getVelocity();
  transferGauntletVelocity(boss, player, 0.65, impactVelocity);
  spawnGauntletImpact(boss.dimension, player.location, 22);
  spawnGauntletRing(
    boss.dimension,
    { ...player.location, y: player.location.y + 0.12 },
    2.7,
    28
  );
  playSound(boss.dimension, "random.explode", player.location, 0.9, 1.12);
  beginRecovery(context, "player");
}

export const normalPunch = {
  id: "punch",
  duration: 70,
  recovery: 9,
  movement: "exclusive",

  start(context) {
    const { boss, target, state, now } = context;
    state.attackData = {
      phase: "windup",
      phaseStartTick: now,
      aimPoint: predictedDrivePoint(boss, target, 4),
      previousLocation: { ...boss.location },
      previousVelocity: { ...boss.getVelocity() },
      previousSpeed: gauntletSpeed(boss),
      hitPlayer: false,
      finished: false
    };
    setGauntletDashPhysics(boss, false);
    setGauntletEnergy(boss, 0);
    setGauntletEyeOpen(boss, true);
    setGauntletHandClosed(boss, false);
    setGauntletAnimation(boss, GAUNTLET_ANIMATION_STATE.punch);
    setGauntletDesiredVelocity(boss, scale(boss.getVelocity(), 0.35), 0.5);
    const view = boss.getViewDirection();
    destroyGauntletBox(
      boss.dimension,
      {
        x: boss.location.x + view.x * 1.5,
        y: boss.location.y + 1.5,
        z: boss.location.z + view.z * 1.5
      },
      { x: 1.25, y: 1.7, z: 1.25 },
      24
    );
  },

  tick(context) {
    const { boss, target, state, now } = context;
    const data = state.attackData;
    const phaseTicks = now - data.phaseStartTick;

    if (data.phase === "windup") {
      data.aimPoint = predictedDrivePoint(boss, target, Math.max(2, 6 - Math.floor(phaseTicks / 3)));
      setGauntletDesiredVelocity(boss, { x: 0, y: 0, z: 0 }, 0.24);
      if (phaseTicks === 6) {
        setGauntletEyeOpen(boss, false);
        setGauntletHandClosed(boss, true);
      }
      if (phaseTicks === 9) {
        playSound(boss.dimension, "mob.blaze.hit", boss.location, 2, 0.82);
      }
      if (phaseTicks >= WINDUP_TICKS) {
        data.phase = "charge";
        data.phaseStartTick = now;
        data.previousLocation = { ...boss.location };
        data.previousVelocity = { ...boss.getVelocity() };
        data.previousSpeed = gauntletSpeed(boss);
        data.aimPoint = predictedDrivePoint(boss, target, 7);
        setGauntletDashPhysics(boss, true);
      }
      return;
    }

    if (data.phase === "charge") {
      const chargeTicks = phaseTicks;
      if (chargeTicks < 9) {
        const refreshed = predictedDrivePoint(boss, target, 5);
        data.aimPoint = {
          x: data.aimPoint.x * 0.78 + refreshed.x * 0.22,
          y: data.aimPoint.y * 0.78 + refreshed.y * 0.22,
          z: data.aimPoint.z * 0.78 + refreshed.z * 0.22
        };
      }
      const origin = centerOfBossAt(boss.location);
      const direction = normalize(subtract(data.aimPoint, origin));
      const remaining = distance(origin, data.aimPoint);
      const speed = remaining < 4 ? Math.max(0.42, CHARGE_SPEED * (remaining / 4)) : CHARGE_SPEED;
      setGauntletDesiredVelocity(boss, scale(direction, speed), 0.64);

      const wall = traceChargeWall(boss, data.previousLocation, direction);
      if (wall) {
        resolveWallImpact(context);
        return;
      }
      for (const player of combatPlayers(boss.dimension, boss.location, 4.5)) {
        if (gauntletSweepsPlayer(data.previousLocation, boss, player)) {
          resolvePlayerImpact(context, player);
          return;
        }
      }

      data.previousLocation = { ...boss.location };
      data.previousVelocity = { ...boss.getVelocity() };
      data.previousSpeed = gauntletSpeed(boss);

      if (remaining <= 1.8 || chargeTicks >= MAX_CHARGE_TICKS) {
        beginRecovery(context, remaining <= 1.8 ? "miss" : "timeout");
      }
      return;
    }

    if (data.phase === "recovery") {
      setGauntletDesiredVelocity(boss, { x: 0, y: 0, z: 0 }, 0.38);
      if (phaseTicks >= RECOVERY_TICKS) {
        data.finished = true;
      }
    }
  },

  finish(context) {
    setGauntletDashPhysics(context.boss, false);
    setGauntletDesiredVelocity(context.boss, { x: 0, y: 0, z: 0 }, 0.55);
    setGauntletAnimation(context.boss, GAUNTLET_ANIMATION_STATE.idle);
    setGauntletEnergy(context.boss, 0);
    setGauntletEyeOpen(context.boss, true);
    setGauntletHandClosed(context.boss, false);
  }
};
