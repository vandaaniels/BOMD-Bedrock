// @ts-check

import { distance } from "../../core/vector.js";

const DAMAGE_MEMORY_TICKS = 20 * 30;
const DAMAGE_HITS_TO_REMEMBER = 10;

function rebuildDamageTotals(state, now) {
  state.damageHistory = state.damageHistory
    .filter((entry) => entry.tick + DAMAGE_MEMORY_TICKS >= now)
    .slice(-DAMAGE_HITS_TO_REMEMBER);
  state.damageByPlayer.clear();
  for (const entry of state.damageHistory) {
    state.damageByPlayer.set(
      entry.playerId,
      (state.damageByPlayer.get(entry.playerId) ?? 0) + entry.amount
    );
  }
}

export function rememberPlayerDamage(state, player, amount, now) {
  if (amount <= 4) return;
  state.damageHistory.push({
    playerId: player.id,
    amount,
    tick: now
  });
  rebuildDamageTotals(state, now);
}

export function clearCurrentTarget(state) {
  state.lastTargetId = state.currentTargetId;
  state.currentTargetId = undefined;
  state.validTargets = [];
}

function canSeePlayer(boss, player) {
  const start = {
    x: boss.location.x,
    y: boss.location.y + 3.2,
    z: boss.location.z
  };
  const end = {
    x: player.location.x,
    y: player.location.y + 1.45,
    z: player.location.z
  };
  const delta = {
    x: end.x - start.x,
    y: end.y - start.y,
    z: end.z - start.z
  };
  const rayLength = Math.sqrt(delta.x ** 2 + delta.y ** 2 + delta.z ** 2);
  if (rayLength <= 0.01) return true;
  try {
    const hit = boss.dimension.getBlockFromRay(
      start,
      {
        x: delta.x / rayLength,
        y: delta.y / rayLength,
        z: delta.z / rayLength
      },
      {
        maxDistance: Math.max(0.1, rayLength - 0.35),
        includeLiquidBlocks: false,
        includePassableBlocks: false
      }
    );
    return !hit;
  } catch {
    // Keep combat functional on runtimes where block raycasting is unavailable.
    return true;
  }
}

export function selectCombatTarget(boss, players, state, now, allowDamageSwitch = false) {
  const visiblePlayers = players.filter((player) => canSeePlayer(boss, player));
  const targetPool = visiblePlayers.length > 0 ? visiblePlayers : players;
  state.validTargets = visiblePlayers.map((player) => player.id);
  rebuildDamageTotals(state, now);

  const current = targetPool.find((player) => player.id === state.currentTargetId);
  if (current && !allowDamageSwitch) return current;

  const preferred = [...targetPool].sort((left, right) => {
    const damageDifference = (state.damageByPlayer.get(right.id) ?? 0) -
      (state.damageByPlayer.get(left.id) ?? 0);
    if (damageDifference !== 0) return damageDifference;
    return distance(left.location, boss.location) - distance(right.location, boss.location);
  })[0];

  let selected = current;
  if (
    allowDamageSwitch &&
    preferred &&
    preferred.id !== current?.id &&
    now >= state.targetSwitchCooldown
  ) {
    state.targetSwitchCooldown = now + 40;
    if (!current || Math.random() < 0.5) selected = preferred;
  }

  selected ??= preferred ?? [...targetPool].sort(
    (left, right) => distance(left.location, boss.location) - distance(right.location, boss.location)
  )[0];

  if (selected?.id !== state.currentTargetId) {
    state.lastTargetId = state.currentTargetId;
    state.currentTargetId = selected?.id;
  }
  return selected;
}
