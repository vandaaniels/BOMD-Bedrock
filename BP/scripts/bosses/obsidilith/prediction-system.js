// @ts-check

const POSITION_SAMPLES = 10;
const TELEPORT_DISTANCE_SQUARED = 5;
const HISTORY_RETENTION_TICKS = 20 * 30;

function squaredDistance(left, right) {
  const x = left.x - right.x;
  const y = left.y - right.y;
  const z = left.z - right.z;
  return x * x + y * y + z * z;
}

export function recordTargetPositions(positionHistory, players, now) {
  const seen = new Set();
  for (const player of players) {
    seen.add(player.id);
    const current = { ...player.location };
    const entry = positionHistory.get(player.id) ?? { samples: [], lastSeen: now };
    const previous = entry.samples[entry.samples.length - 1];
    if (previous && squaredDistance(previous, current) > TELEPORT_DISTANCE_SQUARED) {
      entry.samples.length = 0;
    }
    entry.samples.push(current);
    entry.samples = entry.samples.slice(-POSITION_SAMPLES);
    entry.lastSeen = now;
    positionHistory.set(player.id, entry);
  }

  for (const [playerId, entry] of positionHistory) {
    if (!seen.has(playerId) && entry.lastSeen + HISTORY_RETENTION_TICKS < now) {
      positionHistory.delete(playerId);
    }
  }
}

export function approximateNextPosition(positionHistory, player) {
  const current = { ...player.location };
  const samples = positionHistory.get(player.id)?.samples ?? [];
  if (samples.length === 0) return current;

  const summedOffset = samples.reduce(
    (sum, sample) => ({
      x: sum.x + sample.x - current.x,
      z: sum.z + sample.z - current.z
    }),
    { x: 0, z: 0 }
  );
  return {
    x: current.x - summedOffset.x * 0.5,
    y: current.y,
    z: current.z - summedOffset.z * 0.5
  };
}
