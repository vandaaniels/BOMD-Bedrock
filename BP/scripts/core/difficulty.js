// @ts-check

import { Difficulty, system, world } from "@minecraft/server";
import { isJavaExactMode } from "./combat_mode.js";

/**
 * Hard keeps the original Java combat values. Normal and Easy deliberately
 * add recovery and reduce outgoing pressure, while Peaceful keeps encounters
 * testable without allowing bosses to damage players.
 */
const PROFILES = Object.freeze({
  [Difficulty.Peaceful]: Object.freeze({
    damage: 0,
    movement: 0.72,
    recoveryTicks: 60,
    effectDuration: 0.5,
    incomingDamage: 1.35,
    explosionPower: 0,
    minionHealth: 0.65,
    visualDensity: 0.65
  }),
  [Difficulty.Easy]: Object.freeze({
    damage: 0.70,
    movement: 0.86,
    recoveryTicks: 24,
    effectDuration: 0.65,
    incomingDamage: 1.20,
    explosionPower: 0.72,
    minionHealth: 0.78,
    visualDensity: 0.78
  }),
  [Difficulty.Normal]: Object.freeze({
    damage: 0.88,
    movement: 1.00,
    recoveryTicks: 8,
    effectDuration: 0.85,
    incomingDamage: 1.10,
    explosionPower: 0.88,
    minionHealth: 0.90,
    visualDensity: 0.90
  }),
  [Difficulty.Hard]: Object.freeze({
    damage: 1,
    movement: 1.12,
    recoveryTicks: 0,
    effectDuration: 1,
    incomingDamage: 1,
    explosionPower: 1,
    minionHealth: 1,
    visualDensity: 1
  })
});

let cachedDifficulty = Difficulty.Normal;
let refreshAfterTick = -1;

function refreshDifficulty() {
  if (system.currentTick < refreshAfterTick) return;
  refreshAfterTick = system.currentTick + 20;
  try {
    cachedDifficulty = world.getDifficulty();
  } catch {
    cachedDifficulty = Difficulty.Normal;
  }
}

const JAVA_EXACT_PROFILE = Object.freeze({
  damage: 1,
  movement: 1,
  recoveryTicks: 0,
  effectDuration: 1,
  incomingDamage: 1,
  explosionPower: 1,
  minionHealth: 1,
  visualDensity: 1
});

export function difficultyProfile() {
  if (isJavaExactMode()) return JAVA_EXACT_PROFILE;
  refreshDifficulty();
  return PROFILES[cachedDifficulty] ?? PROFILES[Difficulty.Normal];
}

export function scaleBossDamage(baseDamage) {
  return Math.max(0, baseDamage * difficultyProfile().damage);
}

export function scaleBossMovement(baseSpeed) {
  return baseSpeed * difficultyProfile().movement;
}

export function bossRecoveryTicks() {
  return difficultyProfile().recoveryTicks;
}

export function scaleBossEffectTicks(baseTicks) {
  return Math.max(1, Math.round(baseTicks * difficultyProfile().effectDuration));
}

export function scaleBossExplosionPower(basePower) {
  return Math.max(0, basePower * difficultyProfile().explosionPower);
}

export function scaleDamageToBoss(baseDamage) {
  return Math.max(0, baseDamage * difficultyProfile().incomingDamage);
}

export function scaleMinionHealth(baseHealth) {
  return Math.max(1, Math.round(baseHealth * difficultyProfile().minionHealth));
}

export function scaleVisualCount(baseCount) {
  return Math.max(1, Math.round(baseCount * difficultyProfile().visualDensity));
}
