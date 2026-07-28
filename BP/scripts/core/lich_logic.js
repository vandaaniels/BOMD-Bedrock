// @ts-check

import { appendDamageMemory, highestDamageAttacker } from "./damage_memory.js";

export const UPSTREAM_BASE_HEALTH = 300;
export const UPSTREAM_IDLE_HEAL_PER_TICK = 0.2;
export const REGULAR_PHANTOM_COUNT = 1;
export const RAGE_PHANTOM_COUNT = 9;
export const ATTACK_HISTORY_LIMIT = 4;

export function healthPhase(currentValue, maximumValue) {
  const maximum = Math.max(1, maximumValue);
  const ratio = currentValue / maximum;
  if (ratio <= 0.25) {
    return 4;
  }
  if (ratio <= 0.5) {
    return 3;
  }
  if (ratio <= 0.75) {
    return 2;
  }
  return 1;
}

export function cappedHealingLimit(maximumValue, phase) {
  const maximum = Math.max(1, maximumValue);
  const stageCaps = [1, 1, 0.75, 0.5, 0.25];
  const safePhase = Math.max(1, Math.min(4, Math.floor(phase)));
  return Math.max(1, maximum * stageCaps[safePhase] - 1);
}

export function shouldCappedHeal(hasTarget) {
  return !hasTarget;
}

export function appendAttackHistory(history, attackId) {
  return [...history, attackId].slice(-ATTACK_HISTORY_LIMIT);
}

export function regularAttackWeights({
  attackHistory,
  teleportWeight
}) {
  return {
    comet: 1,
    magic_missile_volley: 1,
    summon_phantoms: attackHistory.includes("summon_phantoms") ? 0 : 2,
    teleport: Math.max(0, teleportWeight)
  };
}

export function calculateTeleportWeight({
  inLineOfSight,
  distanceTraveled,
  targetDistance
}) {
  return (
    (inLineOfSight ? 0 : 4) +
    (distanceTraveled > 0.25 ? 0 : 8) +
    (targetDistance < 6 ? 8 : 0)
  );
}

export function rememberDamage(history, hit) {
  return appendDamageMemory(history, hit, 4);
}

export function highestRememberedAttacker(history, candidateIds, currentTick) {
  return highestDamageAttacker(history, candidateIds, currentTick);
}

export function rageMinionDelays() {
  const delays = [];
  for (let index = 0; index < RAGE_PHANTOM_COUNT; index += 1) {
    const consecutiveSum = (index * (index + 1)) / 2;
    delays.push(40 + index * 40 - consecutiveSum * 3);
  }
  return delays;
}
