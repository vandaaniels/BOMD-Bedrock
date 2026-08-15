// @ts-check

export const UPSTREAM_BASE_HEALTH = 300;
export const UPSTREAM_IDLE_HEAL_PER_TICK = 0.2;
export const REGULAR_PHANTOM_COUNT = 1;
export const RAGE_PHANTOM_COUNT = 9;
export const ATTACK_HISTORY_LIMIT = 4;
export const DAMAGE_MEMORY_LIMIT = 5;
export const DAMAGE_MEMORY_TICKS = 20 * 30;

export function clampPlayerCount(count) {
  return Math.max(1, Math.min(8, Math.floor(count)));
}

export function scaledHealth(playerCount) {
  const players = clampPlayerCount(playerCount);
  return Math.round(
    UPSTREAM_BASE_HEALTH * (1 + 0.55 * (players - 1))
  );
}

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
  if (hit.damage <= 4) {
    return history;
  }
  return [...history, hit].slice(-DAMAGE_MEMORY_LIMIT);
}

export function highestRememberedAttacker(
  history,
  candidateIds,
  currentTick
) {
  const candidates = new Set(candidateIds);
  const totals = new Map();

  for (const hit of history) {
    if (
      currentTick - hit.tick > DAMAGE_MEMORY_TICKS ||
      !candidates.has(hit.playerId)
    ) {
      continue;
    }
    totals.set(
      hit.playerId,
      (totals.get(hit.playerId) ?? 0) + hit.damage
    );
  }

  let winner;
  let winnerDamage = Number.NEGATIVE_INFINITY;
  for (const [playerId, damage] of totals) {
    if (damage > winnerDamage) {
      winner = playerId;
      winnerDamage = damage;
    }
  }
  return winner;
}

export function rageMinionDelays() {
  const delays = [];
  for (let index = 0; index < RAGE_PHANTOM_COUNT; index += 1) {
    const consecutiveSum = (index * (index + 1)) / 2;
    delays.push(40 + index * 40 - consecutiveSum * 3);
  }
  return delays;
}
