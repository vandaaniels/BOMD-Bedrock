// @ts-check

import { LICH_PHANTOM_TYPE } from "../core/config.js";
import { configureLichPhantom } from "../bosses/lich_phantoms.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import { add, normalize, scale } from "../core/vector.js";

const PHANTOM_MIN_DISTANCE = 4;
const PHANTOM_MAX_DISTANCE = 8;
const PHANTOM_HALF_WIDTH = 0.9;
const PHANTOM_HEIGHT = 0.9;
const PLACEMENT_ATTEMPTS = 30;

function randomDirection() {
  let direction;
  do {
    direction = {
      x: Math.random() - 0.5,
      y: Math.random() * 0.7 + 0.15,
      z: Math.random() - 0.5
    };
  } while (
    Math.abs(direction.x) +
      Math.abs(direction.y) +
      Math.abs(direction.z) <
    0.001
  );
  return normalize(direction);
}

function openAir(dimension, location) {
  const xs = [
    location.x - PHANTOM_HALF_WIDTH,
    location.x + PHANTOM_HALF_WIDTH
  ];
  const ys = [
    location.y + 0.05,
    location.y + PHANTOM_HEIGHT - 0.05
  ];
  const zs = [
    location.z - PHANTOM_HALF_WIDTH,
    location.z + PHANTOM_HALF_WIDTH
  ];

  try {
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) {
          const block = dimension.getBlock({
            x: Math.floor(x),
            y: Math.floor(y),
            z: Math.floor(z)
          });
          if (!block?.isAir) return false;
        }
      }
    }
  } catch {
    return false;
  }
  return true;
}

export function findPhantomSummonLocation(target) {
  for (let attemptIndex = 0; attemptIndex < PLACEMENT_ATTEMPTS; attemptIndex += 1) {
    const radius =
      PHANTOM_MIN_DISTANCE +
      Math.random() * (PHANTOM_MAX_DISTANCE - PHANTOM_MIN_DISTANCE);
    const location = add(target.location, scale(randomDirection(), radius));
    if (openAir(target.dimension, location)) return location;
  }
  return undefined;
}

export function spawnLichPhantom(boss, target, location, label) {
  const phantom = attempt(
    () => boss.dimension.spawnEntity(LICH_PHANTOM_TYPE, location),
    label
  );
  if (!isEntityUsable(phantom)) return undefined;

  configureLichPhantom(phantom, boss, target);
  return phantom;
}
