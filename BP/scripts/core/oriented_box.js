// @ts-check

import { normalize } from "./vector.js";

function dot(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left, right) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x
  };
}

function addScaled(origin, axis, amount) {
  return {
    x: origin.x + axis.x * amount,
    y: origin.y + axis.y * amount,
    z: origin.z + axis.z * amount
  };
}

export function facingBasis(viewDirection) {
  let forward = normalize(viewDirection);
  if (
    Math.abs(forward.x) + Math.abs(forward.y) + Math.abs(forward.z) <
    0.001
  ) {
    forward = { x: 0, y: 0, z: 1 };
  }
  let right = normalize(cross({ x: 0, y: 1, z: 0 }, forward));
  if (Math.abs(right.x) + Math.abs(right.z) < 0.001) {
    right = { x: 1, y: 0, z: 0 };
  }
  const up = normalize(cross(forward, right));
  return { right, up, forward };
}

export function horizontalFacingBasis(viewDirection) {
  return facingBasis({
    x: viewDirection.x,
    y: 0,
    z: viewDirection.z
  });
}

export function rotateBasisPitch(basis, degrees) {
  if (!degrees) {
    return basis;
  }
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    right: basis.right,
    up: {
      x: basis.up.x * cosine + basis.forward.x * sine,
      y: basis.up.y * cosine + basis.forward.y * sine,
      z: basis.up.z * cosine + basis.forward.z * sine
    },
    forward: {
      x: basis.forward.x * cosine - basis.up.x * sine,
      y: basis.forward.y * cosine - basis.up.y * sine,
      z: basis.forward.z * cosine - basis.up.z * sine
    }
  };
}

export function localToWorld(origin, basis, local) {
  let result = addScaled(origin, basis.right, local.x);
  result = addScaled(result, basis.up, local.y);
  return addScaled(result, basis.forward, local.z);
}

export function makeOrientedBox({
  id,
  origin,
  basis,
  center,
  size,
  pitch = 0,
  thorn = false,
  collider = ""
}) {
  return {
    id,
    thorn,
    collider,
    center: localToWorld(origin, basis, center),
    basis: rotateBasisPitch(basis, pitch),
    half: {
      x: size.x * 0.5,
      y: size.y * 0.5,
      z: size.z * 0.5
    }
  };
}

export function rayOrientedBoxDistance(
  rayOrigin,
  rayDirection,
  maximumDistance,
  box,
  inflate = 0
) {
  const direction = normalize(rayDirection);
  const offset = {
    x: rayOrigin.x - box.center.x,
    y: rayOrigin.y - box.center.y,
    z: rayOrigin.z - box.center.z
  };
  let minimum = 0;
  let maximum = maximumDistance;
  for (const [axis, extent] of [
    [box.basis.right, box.half.x + inflate],
    [box.basis.up, box.half.y + inflate],
    [box.basis.forward, box.half.z + inflate]
  ]) {
    const originProjection = dot(offset, axis);
    const directionProjection = dot(direction, axis);
    if (Math.abs(directionProjection) < 0.000001) {
      if (Math.abs(originProjection) > extent) {
        return Number.POSITIVE_INFINITY;
      }
      continue;
    }
    let near = (-extent - originProjection) / directionProjection;
    let far = (extent - originProjection) / directionProjection;
    if (near > far) {
      [near, far] = [far, near];
    }
    minimum = Math.max(minimum, near);
    maximum = Math.min(maximum, far);
    if (minimum > maximum) {
      return Number.POSITIVE_INFINITY;
    }
  }
  return minimum <= maximumDistance
    ? Math.max(0, minimum)
    : Number.POSITIVE_INFINITY;
}

export function firstOrientedBoxHit(
  boxes,
  rayOrigin,
  rayDirection,
  maximumDistance,
  inflate = 0
) {
  let first;
  for (const box of boxes) {
    const hitDistance = rayOrientedBoxDistance(
      rayOrigin,
      rayDirection,
      maximumDistance,
      box,
      inflate
    );
    if (
      Number.isFinite(hitDistance) &&
      (!first || hitDistance < first.distance)
    ) {
      first = { ...box, distance: hitDistance };
    }
  }
  return first;
}

export function pointSegmentDistance(point, start, end) {
  const segment = {
    x: end.x - start.x,
    y: end.y - start.y,
    z: end.z - start.z
  };
  const lengthSquared = dot(segment, segment);
  if (lengthSquared < 0.000001) {
    const delta = {
      x: point.x - start.x,
      y: point.y - start.y,
      z: point.z - start.z
    };
    return Math.sqrt(dot(delta, delta));
  }
  const fromStart = {
    x: point.x - start.x,
    y: point.y - start.y,
    z: point.z - start.z
  };
  const factor = Math.max(0, Math.min(1, dot(fromStart, segment) / lengthSquared));
  const closest = {
    x: start.x + segment.x * factor,
    y: start.y + segment.y * factor,
    z: start.z + segment.z * factor
  };
  const delta = {
    x: point.x - closest.x,
    y: point.y - closest.y,
    z: point.z - closest.z
  };
  return Math.sqrt(dot(delta, delta));
}
