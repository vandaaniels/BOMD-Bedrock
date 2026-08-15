// @ts-check

import { LICH_PHANTOM_TYPE, MINION_TAG } from "../core/config.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import { add, normalize, scale } from "../core/vector.js";

const PHANTOM_HALF_WIDTH = 0.95;
const PHANTOM_HEIGHT = 1.15;
const PLACEMENT_ATTEMPTS = 30;

function randomDirection() {
  let direction;
  do {
    direction = {
      x: Math.random() - 0.5,
      y: Math.random() - 0.5,
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

function summonOffset() {
  // Java RangedSpawnPosition receives a randVec whose magnitude is always
  // below the 4-block minimum, so the final offset is a random 3D direction
  // normalized to exactly four blocks.
  return scale(randomDirection(), 4.0);
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
          if (!block?.isAir) {
            return false;
          }
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
    const location = add(target.location, summonOffset());
    if (openAir(target.dimension, location)) {
      return location;
    }
  }
  return undefined;
}

export function spawnLichPhantom(boss, location, label) {
  const phantom = attempt(
    () => boss.dimension.spawnEntity(LICH_PHANTOM_TYPE, location),
    label
  );
  if (!isEntityUsable(phantom)) {
    return undefined;
  }

  phantom.addTag(MINION_TAG);
  return phantom;
}
