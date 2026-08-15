// @ts-check

import {
  GAUNTLET_ANIMATION_STATE,
  GAUNTLET_ENERGIZED_EXPLOSION_POWER,
  GAUNTLET_SPIN_DAMAGE
} from "../../core/config.js";
import { resolveCalculatedExplosion } from "../../core/explosion.js";
import { usesBalancedScaling } from "../../core/balance.js";
import { attempt } from "../../core/safe.js";
import { distance, length, normalize, scale, subtract } from "../../core/vector.js";
import { playSound } from "../../visuals/frost.js";
import { spawnGauntletImpact, spawnGauntletRing } from "../../visuals/gauntlet.js";
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

const WINDUP_TICKS = 25;
const MAX_CHARGE_TICKS = 34;
const RECOVERY_TICKS = 14;
const CHARGE_SPEED = 0.76;

function bossCenter(location) {
  return { x: location.x, y: location.y + 1.2, z: location.z };
}

function aimPoint(boss, target, lead = 6) {
  const predicted = predictTargetCenter(target, lead, 0.9, 4.2);
  const origin = bossCenter(boss.location);
  const delta = subtract(predicted, origin);
  return {
    x: origin.x + delta.x * 1.1,
    y: origin.y + delta.y * 1.1,
    z: origin.z + delta.z * 1.1
  };
}

function traceWall(boss, previousLocation, direction) {
  const from = bossCenter(previousLocation);
  const to = bossCenter(boss.location);
  let delta = subtract(to, from);
  let travelled = length(delta);
  if (travelled < 0.03) {
    delta = direction;
    travelled = 0;
  }
  const rayDirection = normalize(delta);
  const horizontal = Math.sqrt(rayDirection.x * rayDirection.x + rayDirection.z * rayDirection.z);
  const right = horizontal > 0.001
    ? { x: rayDirection.z / horizontal, y: 0, z: -rayDirection.x / horizontal }
    : { x: 1, y: 0, z: 0 };
  for (const side of [-0.68, 0, 0.68]) {
    for (const height of [-0.6, 0.15, 0.8]) {
      const hit = attempt(
        () => boss.dimension.getBlockFromRay({
          x: from.x + right.x * side,
          y: from.y + height,
          z: from.z + right.z * side
        }, rayDirection, {
          maxDistance: travelled + 1.1,
          includeLiquidBlocks: false,
          includePassableBlocks: false
        }),
        "trace scripted energized Nether Gauntlet wall"
      );
      if (hit) return hit;
    }
  }
  return undefined;
}

function enterRecovery(context, reason) {
  const { boss, state, now } = context;
  const data = state.attackData;
  if (data.phase === "recovery") return;
  data.phase = "recovery";
  data.phaseStartTick = now;
  data.recoveryReason = reason;
  setGauntletDashPhysics(boss, false);
  setGauntletDesiredVelocity(boss, { x: 0, y: 0, z: 0 }, 0.74);
  setGauntletEnergy(boss, 0);
  setGauntletEyeOpen(boss, true);
  setGauntletHandClosed(boss, false);
}

function energizedWallImpact(context) {
  const { boss, state } = context;
  const data = state.attackData;
  attempt(() => boss.teleport(data.previousLocation), "rollback energized Gauntlet wall impact");
  attempt(() => boss.clearVelocity(), "stop energized Gauntlet wall impact");
  spawnGauntletImpact(boss.dimension, boss.location, 46);
  spawnGauntletRing(boss.dimension, { ...boss.location, y: boss.location.y + 0.15 }, 4.8, 44);
  resolveCalculatedExplosion(boss, boss.location, GAUNTLET_ENERGIZED_EXPLOSION_POWER, {
    balancedScale: 0.7,
    balancedCap: 46,
    destroyRadius: usesBalancedScaling() ? 2.75 : GAUNTLET_ENERGIZED_EXPLOSION_POWER
  });
  playSound(boss.dimension, "random.explode", boss.location, 1.35, 0.78);
  enterRecovery(context, "wall");
}

function playerImpact(context, player) {
  const { boss, state } = context;
  const data = state.attackData;
  if (data.hitPlayer) return;
  data.hitPlayer = true;
  damagePlayer(player, boss, GAUNTLET_SPIN_DAMAGE, "damage with scripted energized Nether Gauntlet punch");
  transferGauntletVelocity(boss, player, 0.8, data.previousVelocity ?? boss.getVelocity());
  spawnGauntletImpact(boss.dimension, player.location, 30);
  spawnGauntletRing(boss.dimension, { ...player.location, y: player.location.y + 0.12 }, 3.5, 34);
  playSound(boss.dimension, "random.explode", player.location, 1.05, 0.94);
  enterRecovery(context, "player");
}

export const spinPunch = {
  id: "spin",
  duration: 78,
  recovery: 10,
  movement: "exclusive",

  start(context) {
    const { boss, target, state, now } = context;
    state.attackData = {
      phase: "windup",
      phaseStartTick: now,
      aimPoint: aimPoint(boss, target, 4),
      previousLocation: { ...boss.location },
      previousVelocity: { ...boss.getVelocity() },
      previousSpeed: gauntletSpeed(boss),
      hitPlayer: false,
      finished: false
    };
    setGauntletDashPhysics(boss, false);
    setGauntletEyeOpen(boss, true);
    setGauntletHandClosed(boss, false);
    setGauntletEnergy(boss, 2);
    setGauntletAnimation(boss, GAUNTLET_ANIMATION_STATE.spin);
    playSound(boss.dimension, "bomd.nether_gauntlet.energized", boss.location, 2.2, 1);
  },

  tick(context) {
    const { boss, target, state, now } = context;
    const data = state.attackData;
    const phaseTicks = now - data.phaseStartTick;

    if (data.phase === "windup") {
      data.aimPoint = aimPoint(boss, target, Math.max(3, 7 - Math.floor(phaseTicks / 5)));
      setGauntletDesiredVelocity(boss, { x: 0, y: 0, z: 0 }, 0.2);
      if (phaseTicks === 7) {
        setGauntletEyeOpen(boss, false);
        setGauntletHandClosed(boss, true);
      }
      if (phaseTicks >= WINDUP_TICKS) {
        data.phase = "charge";
        data.phaseStartTick = now;
        data.previousLocation = { ...boss.location };
        data.previousVelocity = { ...boss.getVelocity() };
        data.aimPoint = aimPoint(boss, target, 8);
        setGauntletDashPhysics(boss, true);
      }
      return;
    }

    if (data.phase === "charge") {
      const chargeTicks = phaseTicks;
      if (chargeTicks < 12) {
        const refreshed = aimPoint(boss, target, 5);
        data.aimPoint = {
          x: data.aimPoint.x * 0.84 + refreshed.x * 0.16,
          y: data.aimPoint.y * 0.84 + refreshed.y * 0.16,
          z: data.aimPoint.z * 0.84 + refreshed.z * 0.16
        };
      }
      const origin = bossCenter(boss.location);
      const direction = normalize(subtract(data.aimPoint, origin));
      const remaining = distance(origin, data.aimPoint);
      const speed = remaining < 4.5 ? Math.max(0.5, CHARGE_SPEED * remaining / 4.5) : CHARGE_SPEED;
      setGauntletDesiredVelocity(boss, scale(direction, speed), 0.68);

      if (traceWall(boss, data.previousLocation, direction)) {
        energizedWallImpact(context);
        return;
      }
      for (const player of combatPlayers(boss.dimension, boss.location, 4.8)) {
        if (gauntletSweepsPlayer(data.previousLocation, boss, player)) {
          playerImpact(context, player);
          return;
        }
      }
      if (chargeTicks % 3 === 0) {
        spawnGauntletRing(boss.dimension, { ...boss.location, y: boss.location.y + 1.1 }, 2.5, 22);
      }
      data.previousLocation = { ...boss.location };
      data.previousVelocity = { ...boss.getVelocity() };
      data.previousSpeed = gauntletSpeed(boss);
      if (remaining <= 1.9 || chargeTicks >= MAX_CHARGE_TICKS) {
        enterRecovery(context, remaining <= 1.9 ? "miss" : "timeout");
      }
      return;
    }

    if (data.phase === "recovery") {
      setGauntletDesiredVelocity(boss, { x: 0, y: 0, z: 0 }, 0.4);
      if (phaseTicks >= RECOVERY_TICKS) data.finished = true;
    }
  },

  finish(context) {
    setGauntletDashPhysics(context.boss, false);
    setGauntletDesiredVelocity(context.boss, { x: 0, y: 0, z: 0 }, 0.58);
    setGauntletAnimation(context.boss, GAUNTLET_ANIMATION_STATE.idle);
    setGauntletEnergy(context.boss, 0);
    setGauntletEyeOpen(context.boss, true);
    setGauntletHandClosed(context.boss, false);
  }
};
