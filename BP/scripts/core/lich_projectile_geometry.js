// @ts-check

import { add, normalize, scale } from "./vector.js";

export function basisFromLichForward(viewDirection) {
  const forward = normalize(viewDirection);
  const rawRight = { x: -forward.z, y: 0, z: forward.x };
  const right = Math.abs(rawRight.x) + Math.abs(rawRight.z) < 0.001
    ? { x: 1, y: 0, z: 0 }
    : normalize(rawRight);
  const up = normalize({
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x
  });
  return { forward, right, up };
}

function localOffset(basis, y, z) {
  return add(scale(basis.up, y), scale(basis.forward, z));
}

export function regularMissileOffsetsFromView(viewDirection) {
  const basis = basisFromLichForward(viewDirection);
  return [
    localOffset(basis, 1.0, 2.0),
    localOffset(basis, 1.5, 1.0),
    localOffset(basis, 2.0, 0.0),
    localOffset(basis, 1.5, -1.0),
    localOffset(basis, 1.0, -2.0)
  ];
}

function lineOffsets(right, up, mode) {
  const offsets = [];
  for (let index = -4; index <= 4; index += 1) {
    if (mode === "horizontal") {
      offsets.push(scale(right, index));
    } else if (mode === "vertical") {
      offsets.push(scale(up, index));
    } else if (mode === "diagonal_up") {
      offsets.push(add(
        scale(right, index * Math.SQRT1_2),
        scale(up, index * Math.SQRT1_2)
      ));
    } else {
      offsets.push(add(
        scale(right, index * Math.SQRT1_2),
        scale(up, -index * Math.SQRT1_2)
      ));
    }
  }
  return offsets;
}

export function rageFormationOffsetsFromView(viewDirection, formation) {
  const { forward, right, up } = basisFromLichForward(viewDirection);
  const forwardOffset = scale(forward, 3);
  let planeOffsets;
  if (formation === "horizontal") {
    planeOffsets = lineOffsets(right, up, "horizontal");
  } else if (formation === "vertical") {
    planeOffsets = lineOffsets(right, up, "vertical");
  } else if (formation === "cross") {
    planeOffsets = [
      ...lineOffsets(right, up, "horizontal"),
      ...lineOffsets(right, up, "vertical")
    ];
  } else {
    planeOffsets = [
      ...lineOffsets(right, up, "diagonal_up"),
      ...lineOffsets(right, up, "diagonal_down")
    ];
  }
  return planeOffsets.map((offset) => add(forwardOffset, offset));
}

export const RAGE_FORMATION_TIMELINE = Object.freeze([
  Object.freeze({ tick: 60, formation: "horizontal" }),
  Object.freeze({ tick: 90, formation: "vertical" }),
  Object.freeze({ tick: 120, formation: "cross" }),
  Object.freeze({ tick: 150, formation: "x" })
]);
