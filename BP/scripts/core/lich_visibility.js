// @ts-check

import { attempt, isEntityUsable } from "./safe.js";
import { distance, normalize, subtract } from "./vector.js";

/**
 * Equivalent to the direct ray portion of LichEntity.inLineOfSight in Java.
 * This intentionally does not include the player's facing direction.
 */
export function hasDirectLichLineOfSight(lich, target) {
  if (!isEntityUsable(lich) || !isEntityUsable(target)) return false;

  const origin = lich.getHeadLocation();
  const endpoint = target.getHeadLocation();
  const delta = subtract(endpoint, origin);
  const rayDistance = distance(origin, endpoint);
  if (rayDistance <= 1) return true;

  const blocked = attempt(
    () =>
      lich.dimension.getBlockFromRay(origin, normalize(delta), {
        maxDistance: Math.max(0.1, rayDistance - 0.75),
        includeLiquidBlocks: false,
        includePassableBlocks: false
      }),
    "trace Night Lich direct line of sight"
  );
  return !blocked;
}

/**
 * Java's LichEntity.inLineOfSight also requires the target to face generally
 * toward the Lich. A positive dot product reproduces facingSameDirection.
 */
export function targetFacesLich(lich, target) {
  if (!isEntityUsable(lich) || !isEntityUsable(target)) return false;

  const targetHead = target.getHeadLocation();
  const directionToLich = normalize(
    subtract(lich.getHeadLocation(), targetHead)
  );
  const view = target.getViewDirection();
  return (
    view.x * directionToLich.x +
      view.y * directionToLich.y +
      view.z * directionToLich.z >
    0
  );
}

/** Exact combat predicate used by the Java Night Lich. */
export function lichInLineOfSight(lich, target) {
  return (
    hasDirectLichLineOfSight(lich, target) &&
    targetFacesLich(lich, target)
  );
}
