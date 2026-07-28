// @ts-check

import { add, normalize, scale, subtract } from "./vector.js";

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function rotateAroundAxis(vector, axis, radians) {
  const unitAxis = normalize(axis);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const parallel = scale(unitAxis, dot(unitAxis, vector) * (1 - cosine));
  const perpendicular = scale(vector, cosine);
  const tangent = scale(cross(unitAxis, vector), sine);
  return add(add(perpendicular, tangent), parallel);
}

export function basisFromForward(forwardInput) {
  const forward = normalize(forwardInput);
  let right = cross({ x: 0, y: 1, z: 0 }, forward);
  if (Math.hypot(right.x, right.y, right.z) < 0.001) {
    right = { x: 1, y: 0, z: 0 };
  } else {
    right = normalize(right);
  }
  const up = normalize(cross(forward, right));
  return { right, up, forward };
}

export function rotateBasisPitch(basis, degrees) {
  const radians = (degrees * Math.PI) / 180;
  return {
    right: basis.right,
    up: normalize(rotateAroundAxis(basis.up, basis.right, radians)),
    forward: normalize(rotateAroundAxis(basis.forward, basis.right, radians))
  };
}

export function localPoint(origin, basis, local) {
  return add(
    origin,
    add(
      scale(basis.right, local.x),
      add(scale(basis.up, local.y), scale(basis.forward, local.z))
    )
  );
}

export function createObbFromCenter(id, center, basis, size, margin = 0) {
  return {
    id,
    center,
    axes: [basis.right, basis.up, basis.forward],
    half: {
      x: size.x * 0.5 + margin,
      y: size.y * 0.5 + margin,
      z: size.z * 0.5 + margin
    }
  };
}

export function createObb(id, origin, basis, localCenter, size, margin = 0) {
  return createObbFromCenter(
    id,
    localPoint(origin, basis, localCenter),
    basis,
    size,
    margin
  );
}

/** Returns the ray distance to the first OBB intersection, or Infinity. */
export function rayObbDistance(origin, directionInput, maxDistance, obb) {
  const direction = normalize(directionInput);
  const relative = subtract(origin, obb.center);
  const localOrigin = {
    x: dot(relative, obb.axes[0]),
    y: dot(relative, obb.axes[1]),
    z: dot(relative, obb.axes[2])
  };
  const localDirection = {
    x: dot(direction, obb.axes[0]),
    y: dot(direction, obb.axes[1]),
    z: dot(direction, obb.axes[2])
  };

  let near = 0;
  let far = maxDistance;
  for (const axis of ["x", "y", "z"]) {
    const coordinate = localOrigin[axis];
    const velocity = localDirection[axis];
    const half = obb.half[axis];
    if (Math.abs(velocity) < 1e-7) {
      if (coordinate < -half || coordinate > half) return Number.POSITIVE_INFINITY;
      continue;
    }
    let first = (-half - coordinate) / velocity;
    let second = (half - coordinate) / velocity;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return Number.POSITIVE_INFINITY;
  }
  return near >= 0 && near <= maxDistance ? near : Number.POSITIVE_INFINITY;
}

/** Returns the segment fraction [0,1] to the first OBB intersection. */
export function segmentObbFraction(start, end, obb) {
  const delta = subtract(end, start);
  const length = Math.hypot(delta.x, delta.y, delta.z);
  if (length < 1e-6) return Number.POSITIVE_INFINITY;
  const hitDistance = rayObbDistance(start, delta, length, obb);
  return Number.isFinite(hitDistance) ? hitDistance / length : Number.POSITIVE_INFINITY;
}

export function firstRayObbHit(origin, direction, maxDistance, boxes) {
  let first;
  let firstDistance = Number.POSITIVE_INFINITY;
  for (const box of boxes) {
    const candidate = rayObbDistance(origin, direction, maxDistance, box);
    if (candidate < firstDistance) {
      firstDistance = candidate;
      first = box;
    }
  }
  return first ? { box: first, distance: firstDistance } : undefined;
}

export function firstSegmentObbHit(start, end, boxes) {
  let first;
  let firstFraction = Number.POSITIVE_INFINITY;
  for (const box of boxes) {
    const candidate = segmentObbFraction(start, end, box);
    if (candidate < firstFraction) {
      firstFraction = candidate;
      first = box;
    }
  }
  return first ? { box: first, fraction: firstFraction } : undefined;
}
