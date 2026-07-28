// @ts-check

import { system } from "@minecraft/server";

const chunkLoadCache = new Map();
let lastCachePruneTick = -1;

/**
 * Bedrock throws LocationOutOfWorldBoundariesError before returning undefined,
 * so every scripted block/particle/entity location must be checked first.
 */
export function dimensionHeightRange(dimension) {
  try {
    const range = dimension.heightRange;
    if (
      range &&
      Number.isFinite(range.min) &&
      Number.isFinite(range.max) &&
      range.max > range.min
    ) {
      return { min: range.min, max: range.max };
    }
  } catch {
    // Fall through to vanilla dimension defaults.
  }

  const id = String(dimension?.id ?? "");
  if (id.includes("nether")) return { min: 0, max: 128 };
  if (id.includes("the_end") || id.endsWith(":end")) return { min: 0, max: 256 };
  return { min: -64, max: 320 };
}

export function isWithinWorldHeight(dimension, y, margin = 0) {
  const range = dimensionHeightRange(dimension);
  return Number.isFinite(y) && y >= range.min + margin && y < range.max - margin;
}

export function isLocationWithinWorld(dimension, location, margin = 0) {
  return (
    location &&
    Number.isFinite(location.x) &&
    Number.isFinite(location.y) &&
    Number.isFinite(location.z) &&
    isWithinWorldHeight(dimension, location.y, margin)
  );
}

/**
 * Returns whether Bedrock currently permits script access to the location.
 * Dimension.isChunkLoaded is available in @minecraft/server 2.8.0 and avoids
 * LocationInUnloadedChunkError without forcing permanent ticking areas.
 */
export function isLocationLoaded(dimension, location, margin = 0) {
  if (!isLocationWithinWorld(dimension, location, margin)) return false;
  const chunkX = Math.floor(location.x / 16);
  const chunkZ = Math.floor(location.z / 16);
  const key = `${dimension.id}:${chunkX}:${chunkZ}`;
  const now = system.currentTick;
  const cached = chunkLoadCache.get(key);
  if (cached?.tick === now) return cached.loaded;

  // Dimension.isChunkLoaded is present in the 2.8 API surface, but some
  // Bedrock 26.33 builds can return false for an entity that is already
  // ticking in the queried chunk. Treat it as a fast hint and verify a false
  // result by reading one block. If the function is unavailable, fail open;
  // the operation itself is still protected by the transient-error wrapper.
  let loaded = true;
  try {
    if (typeof dimension.isChunkLoaded === "function") {
      loaded = dimension.isChunkLoaded(location) === true;
      if (!loaded) {
        const probe = {
          x: Math.floor(location.x),
          y: Math.floor(location.y),
          z: Math.floor(location.z)
        };
        dimension.getBlock(probe);
        loaded = true;
      }
    }
  } catch (error) {
    const text = String(error);
    loaded = !(
      text.includes("LocationInUnloadedChunkError") ||
      text.includes("LocationOutOfWorldBoundariesError")
    );
  }
  chunkLoadCache.set(key, { tick: now, loaded });

  if (lastCachePruneTick !== now && now % 200 === 0) {
    lastCachePruneTick = now;
    for (const [cacheKey, value] of chunkLoadCache) {
      if (now - value.tick > 200) chunkLoadCache.delete(cacheKey);
    }
  }
  return loaded;
}

export function clampEntityLocation(dimension, location, margin = 0.05) {
  const range = dimensionHeightRange(dimension);
  return {
    x: location.x,
    y: Math.max(range.min + margin, Math.min(range.max - margin, location.y)),
    z: location.z
  };
}

export function clampBlockLocation(dimension, location) {
  const range = dimensionHeightRange(dimension);
  return {
    x: Math.floor(location.x),
    y: Math.max(range.min, Math.min(range.max - 1, Math.floor(location.y))),
    z: Math.floor(location.z)
  };
}

/**
 * Returns a center/base Y that keeps a structure or query span entirely inside
 * the dimension. minOffset and maxOffset are relative block offsets.
 */
export function fitVerticalSpan(dimension, desiredY, minOffset, maxOffset) {
  const range = dimensionHeightRange(dimension);
  const minimumCenter = range.min - minOffset;
  const maximumCenter = range.max - 1 - maxOffset;
  if (minimumCenter > maximumCenter) return undefined;
  return Math.max(minimumCenter, Math.min(maximumCenter, Math.floor(desiredY)));
}

export function verticalSpanFits(dimension, centerY, minOffset, maxOffset) {
  const range = dimensionHeightRange(dimension);
  return (
    centerY + minOffset >= range.min &&
    centerY + maxOffset < range.max
  );
}

export function maxRayDistanceInsideWorld(dimension, origin, direction, requestedDistance, margin = 0.05) {
  const range = dimensionHeightRange(dimension);
  let maximum = Math.max(0, requestedDistance);
  if (direction.y > 0.000001) {
    maximum = Math.min(maximum, (range.max - margin - origin.y) / direction.y);
  } else if (direction.y < -0.000001) {
    maximum = Math.min(maximum, (range.min + margin - origin.y) / direction.y);
  }
  return Math.max(0, maximum);
}
