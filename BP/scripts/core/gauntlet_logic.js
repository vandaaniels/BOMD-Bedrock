// @ts-check

import {
  add,
  distance,
  normalize,
  scale,
  subtract
} from "./vector.js";
import {
  facingBasis,
  firstOrientedBoxHit,
  makeOrientedBox
} from "./oriented_box.js";

export const GAUNTLET_LASER_HEALTH_THRESHOLD = 0.85;
export const GAUNTLET_SPIN_HEALTH_THRESHOLD = 0.7;
export const GAUNTLET_BLINDNESS_HEALTH_THRESHOLD = 0.5;

export function clampGauntletPlayerCount(playerCount) {
  return Math.max(1, Math.min(8, Math.round(playerCount || 1)));
}

export function scaledGauntletHealth(playerCount) {
  return Math.round(
    250 * (1 + 0.55 * (clampGauntletPlayerCount(playerCount) - 1))
  );
}

export function appendGauntletAttackHistory(history, attackId) {
  return [...history, attackId].slice(-4);
}

export function gauntletImpactPoint(
  location,
  viewDirection,
  forwardDistance = 3.5,
  verticalOffset = 1.5
) {
  const horizontal = normalize({
    x: viewDirection.x,
    y: 0,
    z: viewDirection.z
  });
  return add(
    {
      x: location.x,
      y: location.y + verticalOffset,
      z: location.z
    },
    scale(horizontal, forwardDistance)
  );
}

export function gauntletAttackWeights({
  healthRatio,
  previousAttack,
  attackHistory = previousAttack ? [previousAttack] : []
}) {
  const recentlyUsed = (attackId) => attackHistory.includes(attackId);
  let punch = 1;
  let laser =
    healthRatio < GAUNTLET_LASER_HEALTH_THRESHOLD &&
    previousAttack !== "laser"
      ? 0.7
      : 0;
  let spin =
    healthRatio < GAUNTLET_SPIN_HEALTH_THRESHOLD &&
    previousAttack !== "spin"
      ? 0.7
      : 0;
  let blindness =
    healthRatio < GAUNTLET_BLINDNESS_HEALTH_THRESHOLD &&
    !recentlyUsed("blindness")
      ? 1
      : 0;

  return {
    punch,
    laser,
    spin,
    blindness
  };
}

export function closestDistanceToRay(
  rayOrigin,
  rayDirection,
  point,
  maximumDistance = Number.POSITIVE_INFINITY
) {
  const direction = normalize(rayDirection);
  const offset = subtract(point, rayOrigin);
  const projection =
    offset.x * direction.x +
    offset.y * direction.y +
    offset.z * direction.z;
  if (projection < 0 || projection > maximumDistance) {
    return Number.POSITIVE_INFINITY;
  }
  return distance(
    add(rayOrigin, scale(direction, projection)),
    point
  );
}

export function isEyeInFront(
  bossLocation,
  bossForward,
  eyeOrImpactLocation,
  minimumDot = 0.15
) {
  const impactOffset = {
    x: eyeOrImpactLocation.x - bossLocation.x,
    z: eyeOrImpactLocation.z - bossLocation.z
  };
  if (
    Math.sqrt(
      impactOffset.x * impactOffset.x +
        impactOffset.z * impactOffset.z
    ) < 0.35
  ) {
    return false;
  }
  const forward = normalize({
    x: bossForward.x,
    y: 0,
    z: bossForward.z
  });
  const towardImpact = normalize({
    x: impactOffset.x,
    y: 0,
    z: impactOffset.z
  });
  return (
    forward.x * towardImpact.x + forward.z * towardImpact.z >=
    minimumDot
  );
}

export function rayHitsGauntletEye({
  bossLocation,
  bossForward,
  eyeLocation,
  rayOrigin,
  rayDirection,
  maximumDistance,
  radius = 1.05
}) {
  if (
    !isEyeInFront(
      bossLocation,
      bossForward,
      rayOrigin,
      0.25
    )
  ) {
    return false;
  }
  return (
    closestDistanceToRay(
      rayOrigin,
      rayDirection,
      eyeLocation,
      maximumDistance
    ) <= radius
  );
}

const OPEN_HAND_PARTS = Object.freeze([
  Object.freeze({
    id: "eye",
    center: { x: -0.025, y: 1.65, z: 0.4 },
    size: { x: 1.1, y: 1.2, z: 0.2 },
    pitch: 0
  }),
  Object.freeze({
    id: "fingers",
    center: { x: 0, y: 3.1, z: 0.5 },
    size: { x: 1.5, y: 2, z: 0.5 },
    pitch: 35
  }),
  Object.freeze({
    id: "thumb",
    center: { x: 1, y: 1.9, z: 0.7 },
    size: { x: 0.3, y: 1.6, z: 0.3 },
    pitch: 30
  }),
  Object.freeze({
    id: "pinky",
    center: { x: -0.9, y: 3, z: 0.5 },
    size: { x: 0.25, y: 1, z: 0.25 },
    pitch: 35
  }),
  Object.freeze({
    id: "palm",
    center: { x: 0, y: 1.3, z: 0 },
    size: { x: 2, y: 2.6, z: 0.6 },
    pitch: 0
  })
]);

const CLOSED_FIST_PARTS = Object.freeze([
  Object.freeze({
    id: "fist",
    center: { x: 0, y: 1, z: 0 },
    size: { x: 2, y: 1.5, z: 2 },
    pitch: 0
  })
]);

export function gauntletOrientedParts({
  bossLocation,
  bossForward,
  closed = false
}) {
  const basis = facingBasis(bossForward);
  return (closed ? CLOSED_FIST_PARTS : OPEN_HAND_PARTS).map((part) =>
    makeOrientedBox({
      ...part,
      origin: bossLocation,
      basis
    })
  );
}

export function firstGauntletPartHit({
  bossLocation,
  bossForward,
  closed = false,
  rayOrigin,
  rayDirection,
  maximumDistance,
  inflate = 0
}) {
  return firstOrientedBoxHit(
    gauntletOrientedParts({ bossLocation, bossForward, closed }),
    rayOrigin,
    rayDirection,
    maximumDistance,
    inflate
  );
}

export function explosionApproachesGauntletRear(
  bossLocation,
  bossForward,
  explosionLocation
) {
  const forward = normalize({
    x: bossForward.x,
    y: 0,
    z: bossForward.z
  });
  const towardExplosion = normalize({
    x: explosionLocation.x - bossLocation.x,
    y: 0,
    z: explosionLocation.z - bossLocation.z
  });
  return (
    forward.x * towardExplosion.x +
      forward.z * towardExplosion.z <
    -0.05
  );
}
