// @ts-check

import { attempt } from "./safe.js";
import {
  basisFromForward,
  createObbFromCenter,
  firstRayObbHit,
  firstSegmentObbHit,
  localPoint,
  rotateBasisPitch
} from "./obb.js";

export const GAUNTLET_PART = Object.freeze({
  EYE: "eye",
  PALM: "palm",
  FINGERS: "fingers",
  THUMB: "thumb",
  PINKY: "pinky",
  FIST: "fist"
});

// Java GauntletHitboxes.kt:
// rootPitch offset (0, 1.3, 0), pivot (0, -0.2, 0).
const OPEN_ROOT_OFFSET = Object.freeze({ x: 0, y: 1.3, z: 0 });
const OPEN_ROOT_PIVOT = Object.freeze({ x: 0, y: -0.2, z: 0 });
const FIST_OFFSET = Object.freeze({ x: 0, y: 1.0, z: 0 });

function bossBases(boss) {
  const forward = attempt(() => boss.getViewDirection(), "read Gauntlet hitbox facing") ?? {
    x: 0,
    y: 0,
    z: 1
  };
  const horizontalLength = Math.hypot(forward.x, forward.z);
  const yawForward = horizontalLength > 0.0001
    ? { x: forward.x / horizontalLength, y: 0, z: forward.z / horizontalLength }
    : { x: 0, y: 0, z: 1 };
  const yaw = basisFromForward(yawForward);
  const rotation = attempt(() => boss.getRotation(), "read Gauntlet hitbox rotation");
  const pitch = rotation?.x ?? (-Math.asin(Math.max(-1, Math.min(1, forward.y))) * 180 / Math.PI);
  return { yaw, pitched: rotateBasisPitch(yaw, pitch) };
}

/**
 * Reconstructs the Java rootPitch hierarchy correctly. The root's offset sets
 * the unrotated palm center. Its pivot only defines the point around which the
 * pitched hierarchy rotates; it must not translate every part down by 0.2.
 */
function openRootTransform(entityOrigin, yawBasis, pitchedBasis) {
  const unrotatedCenter = localPoint(entityOrigin, yawBasis, OPEN_ROOT_OFFSET);
  const pivot = localPoint(unrotatedCenter, yawBasis, OPEN_ROOT_PIVOT);
  const centerFromPivot = {
    x: -OPEN_ROOT_PIVOT.x,
    y: -OPEN_ROOT_PIVOT.y,
    z: -OPEN_ROOT_PIVOT.z
  };
  return {
    center: localPoint(pivot, pitchedBasis, centerFromPivot),
    basis: pitchedBasis
  };
}

function childObb(id, rootCenter, rootBasis, childOffset, localPitch, size, margin) {
  const center = localPoint(rootCenter, rootBasis, childOffset);
  const axes = rotateBasisPitch(rootBasis, localPitch);
  return createObbFromCenter(id, center, axes, size, margin);
}

/** Virtual multipart layout derived directly from GauntletHitboxes.kt. */
export function gauntletObbs(boss, eyeOpen, margin = 0.08) {
  const entityOrigin = boss.location;
  const { yaw, pitched } = bossBases(boss);

  if (!eyeOpen) {
    // rootFist has no custom pivot in Java: pitch changes its axes, not its
    // center. The center remains one block above the entity origin.
    const fistCenter = localPoint(entityOrigin, yaw, FIST_OFFSET);
    return [
      createObbFromCenter(
        GAUNTLET_PART.FIST,
        fistCenter,
        pitched,
        { x: 2.0, y: 1.5, z: 2.0 },
        margin
      )
    ];
  }

  const root = openRootTransform(entityOrigin, yaw, pitched);
  return [
    childObb(
      GAUNTLET_PART.EYE,
      root.center,
      root.basis,
      { x: -0.025, y: 0.35, z: 0.4 },
      0,
      { x: 1.1, y: 1.2, z: 0.2 },
      margin
    ),
    createObbFromCenter(
      GAUNTLET_PART.PALM,
      root.center,
      root.basis,
      { x: 2.0, y: 2.6, z: 0.6 },
      margin
    ),
    childObb(
      GAUNTLET_PART.FINGERS,
      root.center,
      root.basis,
      { x: 0, y: 1.8, z: 0.5 },
      35,
      { x: 1.5, y: 2.0, z: 0.5 },
      margin
    ),
    childObb(
      GAUNTLET_PART.THUMB,
      root.center,
      root.basis,
      { x: 1.0, y: 0.6, z: 0.7 },
      30,
      { x: 0.3, y: 1.6, z: 0.3 },
      margin
    ),
    childObb(
      GAUNTLET_PART.PINKY,
      root.center,
      root.basis,
      { x: -0.9, y: 1.7, z: 0.5 },
      35,
      { x: 0.25, y: 1.0, z: 0.25 },
      margin
    )
  ];
}

export function firstGauntletRayPart(boss, eyeOpen, origin, direction, maxDistance, margin = 0.08) {
  return firstRayObbHit(origin, direction, maxDistance, gauntletObbs(boss, eyeOpen, margin));
}

export function firstGauntletSegmentPart(boss, eyeOpen, start, end, margin = 0.08) {
  return firstSegmentObbHit(start, end, gauntletObbs(boss, eyeOpen, margin));
}

export function gauntletEyeCenter(boss) {
  return gauntletObbs(boss, true, 0).find((box) => box.id === GAUNTLET_PART.EYE)?.center ?? {
    x: boss.location.x,
    y: boss.location.y + 1.65,
    z: boss.location.z
  };
}
