// @ts-check

import { ItemStack, system } from "@minecraft/server";
import { BLAZING_EYE_ITEM } from "../core/config.js";
import { attempt } from "../core/safe.js";

const PROTECTED_BLOCKS = new Set([
  "minecraft:air",
  "minecraft:bedrock",
  "minecraft:chest",
  "minecraft:lava",
  "minecraft:flowing_lava",
  "bomd:gauntlet_blackstone",
  "bomd:sealed_blackstone"
]);

function groundBelow(dimension, location) {
  return (
    attempt(
      () =>
        dimension.getBlockBelow(
          {
            x: Math.floor(location.x),
            y: Math.floor(location.y) + 2,
            z: Math.floor(location.z)
          },
          { maxDistance: 16 }
        ),
      "find Nether Gauntlet death floor"
    ) ?? dimension.getBlock({
      x: Math.floor(location.x),
      y: Math.floor(location.y) - 1,
      z: Math.floor(location.z)
    })
  );
}

function replaceVeinBlock(dimension, location, typeId) {
  const block = attempt(
    () => dimension.getBlock(location),
    "read Nether Gauntlet death vein"
  );
  if (!block || PROTECTED_BLOCKS.has(block.typeId)) {
    return false;
  }
  return (
    attempt(
      () => {
        block.setType(typeId);
        return true;
      },
      "place Nether Gauntlet death vein"
    ) === true
  );
}

function placeAncientDebrisVeins(dimension, center) {
  for (let vein = 0; vein < 5; vein += 1) {
    const angle =
      (Math.PI * 2 * vein) / 5 + (Math.random() - 0.5) * 0.45;
    const length = 8 - vein;
    let endpoint;
    for (let step = 1; step <= length; step += 1) {
      const location = {
        x: Math.round(center.x + Math.cos(angle) * step),
        y:
          center.y -
          Math.floor(step / 4) +
          (step % 3 === 0 ? (vein % 2 === 0 ? 1 : -1) : 0),
        z: Math.round(center.z + Math.sin(angle) * step)
      };
      if (
        replaceVeinBlock(
          dimension,
          location,
          "minecraft:netherrack"
        )
      ) {
        endpoint = location;
      }
    }
    if (endpoint) {
      replaceVeinBlock(
        dimension,
        endpoint,
        "minecraft:ancient_debris"
      );
    }
  }
}

function fillRewardChest(dimension, location, retries = 2) {
  const container = attempt(
    () =>
      dimension
        .getBlock(location)
        ?.getComponent("minecraft:inventory")?.container,
    "open Nether Gauntlet reward chest"
  );
  if (!container) {
    if (retries > 0) {
      system.runTimeout(
        () => fillRewardChest(dimension, location, retries - 1),
        1
      );
    } else {
      attempt(
        () => dimension.spawnItem(new ItemStack(BLAZING_EYE_ITEM, 1), location),
        "drop fallback Nether Gauntlet reward"
      );
    }
    return;
  }
  container.clearAll();
  container.addItem(new ItemStack(BLAZING_EYE_ITEM, 1));
}

export function placeGauntletDeathReward(dimension, deathLocation) {
  const ground = groundBelow(dimension, deathLocation);
  if (!ground) {
    attempt(
      () => dimension.spawnItem(new ItemStack(BLAZING_EYE_ITEM, 1), deathLocation),
      "drop Nether Gauntlet reward without floor"
    );
    return;
  }
  const center = {
    x: ground.location.x,
    y: ground.location.y,
    z: ground.location.z
  };
  placeAncientDebrisVeins(dimension, center);

  const chestLocation = {
    x: center.x,
    y: center.y + 1,
    z: center.z
  };
  const chestBlock = attempt(
    () => dimension.getBlock(chestLocation),
    "read Nether Gauntlet reward chest location"
  );
  if (!chestBlock) {
    attempt(
      () => dimension.spawnItem(new ItemStack(BLAZING_EYE_ITEM, 1), deathLocation),
      "drop Nether Gauntlet reward without chest block"
    );
    return;
  }
  attempt(
    () => chestBlock.setType("minecraft:chest"),
    "place Nether Gauntlet reward chest"
  );
  fillRewardChest(dimension, chestLocation);
}
