// @ts-check

import { subtract } from "./vector.js";

/** Returns the first fraction [0,1] where a segment enters an AABB. */
export function segmentAabbFraction(start, end, center, half) {
  const delta = subtract(end, start);
  const relative = subtract(start, center);
  let near = 0;
  let far = 1;
  for (const axis of ["x", "y", "z"]) {
    const origin = relative[axis];
    const velocity = delta[axis];
    const extent = half[axis];
    if (Math.abs(velocity) < 1e-8) {
      if (origin < -extent || origin > extent) return Number.POSITIVE_INFINITY;
      continue;
    }
    let first = (-extent - origin) / velocity;
    let second = (extent - origin) / velocity;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return Number.POSITIVE_INFINITY;
  }
  return near >= 0 && near <= 1 ? near : Number.POSITIVE_INFINITY;
}

export function sweptFistHitsPlayer(previousBossLocation, currentBossLocation, playerLocation) {
  const start = { x: previousBossLocation.x, y: previousBossLocation.y + 1.0, z: previousBossLocation.z };
  const end = { x: currentBossLocation.x, y: currentBossLocation.y + 1.0, z: currentBossLocation.z };
  const playerCenter = { x: playerLocation.x, y: playerLocation.y + 0.9, z: playerLocation.z };
  // Closed fist: 2x2x2. Player approximation: 0.6x1.8x0.6.
  const expandedHalf = { x: 1.3, y: 1.9, z: 1.3 };
  return segmentAabbFraction(start, end, playerCenter, expandedHalf);
}
