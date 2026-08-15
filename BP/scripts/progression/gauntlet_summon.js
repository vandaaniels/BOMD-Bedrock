// @ts-check

import { system, world } from "@minecraft/server";
import {
  GAUNTLET_AWAKE_PROPERTY,
  GAUNTLET_ENERGY_PARTICLE,
  GAUNTLET_SEAL_BLOCK,
  GAUNTLET_TYPE
} from "../core/config.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import {
  playSound,
  spawnBurst
} from "../visuals/frost.js";

let registered = false;

const CROSS_OFFSETS = Object.freeze([
  Object.freeze({ x: 0, z: 0 }),
  Object.freeze({ x: -1, z: 0 }),
  Object.freeze({ x: 1, z: 0 }),
  Object.freeze({ x: 0, z: -1 }),
  Object.freeze({ x: 0, z: 1 })
]);

function sameBlockLocation(left, right) {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.z === right.z
  );
}

function sealScore(dimension, center, brokenLocation) {
  let score = 0;
  for (const offset of CROSS_OFFSETS) {
    const location = {
      x: center.x + offset.x,
      y: center.y,
      z: center.z + offset.z
    };
    if (sameBlockLocation(location, brokenLocation)) {
      score += 1;
      continue;
    }
    const block = attempt(
      () => dimension.getBlock(location),
      "inspect Nether Gauntlet seal"
    );
    if (block?.typeId === GAUNTLET_SEAL_BLOCK) {
      score += 1;
    }
  }
  return score;
}

function findSealCenter(dimension, brokenLocation) {
  const candidates = CROSS_OFFSETS.map((offset) => ({
    x: brokenLocation.x + offset.x,
    y: brokenLocation.y,
    z: brokenLocation.z + offset.z
  }));
  return candidates.sort(
    (left, right) =>
      sealScore(dimension, right, brokenLocation) -
      sealScore(dimension, left, brokenLocation)
  )[0];
}

function openCageLayer(dimension, center, relativeY) {
  for (let x = -1; x <= 1; x += 1) {
    for (let z = -1; z <= 1; z += 1) {
      const block = attempt(
        () =>
          dimension.getBlock({
            x: center.x + x,
            y: center.y + relativeY,
            z: center.z + z
          }),
        "read Nether Gauntlet cage layer"
      );
      if (!block || block.isAir) {
        continue;
      }
      // Java GauntletBlackstoneBlock breaks the complete 3x3 layer, not only
      // BOMD seal blocks. This is the temporary release cage itself.
      attempt(
        () => block.setType("minecraft:air"),
        "open Nether Gauntlet cage"
      );
    }
  }
  spawnBurst(
    dimension,
    {
      x: center.x + 0.5,
      y: center.y + relativeY + 0.5,
      z: center.z + 0.5
    },
    14,
    1.4,
    GAUNTLET_ENERGY_PARTICLE
  );
}


function cleanupTemporaryCage(dimension, center) {
  // Final idempotent pass over the exact Java release volume. It deliberately
  // removes every block in x/z -1..1 and y -1..4 because that whole 3x3x6
  // volume is the temporary cage released by GauntletBlackstoneBlock.
  for (let x = -1; x <= 1; x += 1) {
    for (let z = -1; z <= 1; z += 1) {
      for (let y = -1; y <= 4; y += 1) {
        const block = attempt(
          () => dimension.getBlock({
            x: center.x + x,
            y: center.y + y,
            z: center.z + z
          }),
          "read Nether Gauntlet temporary cage"
        );
        if (!block || block.isAir) {
          continue;
        }
        attempt(
          () => block.setType("minecraft:air"),
          "remove Nether Gauntlet temporary cage"
        );
      }
    }
  }
}

function releaseGauntlet(dimension, location) {
  const existing =
    attempt(
      () =>
        dimension.getEntities({
          type: GAUNTLET_TYPE,
          location,
          maxDistance: 64
        }),
      "check existing Nether Gauntlet"
    ) ?? [];
  if (existing.length > 0) {
    return;
  }

  const spawnLocation = {
    x: location.x + 0.5,
    y: location.y - 0.5,
    z: location.z + 0.5
  };
  const boss = attempt(
    () => dimension.spawnEntity(GAUNTLET_TYPE, spawnLocation),
    "release Nether Gauntlet"
  );
  if (!isEntityUsable(boss)) {
    return;
  }

  boss.nameTag = "Nether Gauntlet";
  boss.setDynamicProperty(GAUNTLET_AWAKE_PROPERTY, false);
  spawnBurst(
    dimension,
    spawnLocation,
    48,
    2.2,
    GAUNTLET_ENERGY_PARTICLE
  );
  playSound(
    dimension,
    "bomd.nether_gauntlet.cast",
    spawnLocation,
    2.2,
    0.72
  );
  for (let relativeY = -1; relativeY <= 4; relativeY += 1) {
    system.runTimeout(
      () => openCageLayer(dimension, location, relativeY),
      10 + relativeY * 5
    );
  }
  system.runTimeout(
    () => cleanupTemporaryCage(dimension, location),
    34
  );
}

export function registerGauntletSummon() {
  if (registered) {
    return;
  }
  registered = true;

  world.afterEvents.playerBreakBlock.subscribe((event) => {
    if (
      event.brokenBlockPermutation.type.id !==
      GAUNTLET_SEAL_BLOCK
    ) {
      return;
    }
    const brokenLocation = { ...event.block.location };
    system.run(() => {
      attempt(
        () => {
          const center = findSealCenter(
            event.dimension,
            brokenLocation
          );
          releaseGauntlet(event.dimension, center);
        },
        "handle broken Nether Gauntlet seal"
      );
    });
  });
}
