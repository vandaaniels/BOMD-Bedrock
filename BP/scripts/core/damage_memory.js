// @ts-check

export const DAMAGE_MEMORY_LIMIT = 5;
export const DAMAGE_MEMORY_TICKS = 20 * 30;

export function appendDamageMemory(history, hit, minimumDamage = 0) {
  if (!hit || hit.damage <= minimumDamage) return history;
  return [...history, hit].slice(-DAMAGE_MEMORY_LIMIT);
}

export function highestDamageAttacker(history, candidateIds, currentTick) {
  const candidates = new Set(candidateIds);
  const totals = new Map();
  for (const hit of history) {
    if (
      currentTick - hit.tick > DAMAGE_MEMORY_TICKS ||
      !candidates.has(hit.playerId)
    ) continue;
    totals.set(hit.playerId, (totals.get(hit.playerId) ?? 0) + hit.damage);
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
