// @ts-check

import { ItemStack, system, world } from "@minecraft/server";
import { translate } from "../core/i18n.js";
import { attempt, schedule } from "../core/safe.js";
import { isLocationLoaded } from "../core/world_bounds.js";
import {
  playGauntletSound,
  spawnGauntletBurst,
  spawnGauntletParticle
} from "../visuals/nether_gauntlet.js";

const RAY_COUNT = 5;
const TOTAL_EXPERIENCE = 1000;
const EXPERIENCE_PULSES = 20;
const CHEST_LOOT_TABLE = "bomd/nether_gauntlet/gauntlet_chest";

function blockIsSolid(block) {
  return block && block.typeId !== "minecraft:air";
}

function findFloorY(dimension, location) {
  const x = Math.floor(location.x);
  const z = Math.floor(location.z);
  for (let y = Math.floor(location.y); y >= Math.floor(location.y) - 4; y -= 1) {
    const block = attempt(
      () => dimension.getBlock({ x, y, z }),
      "find Gauntlet reward floor"
    );
    if (blockIsSolid(block)) {
      return y;
    }
  }
  return Math.floor(location.y) - 1;
}

function setRewardBlock(dimension, location, typeId) {
  const block = attempt(
    () => dimension.getBlock(location),
    `get ${typeId} reward block`
  );
  if (!block) {
    return false;
  }
  return attempt(
    () => {
      block.setType(typeId);
      return true;
    },
    `place ${typeId}`
  ) === true;
}

function createAncientDebrisTrails(dimension, center, floorY) {
  const used = new Set();
  const endpoints = [];
  const baseAngle = Math.random() * Math.PI * 2;
  for (let ray = 0; ray < RAY_COUNT; ray += 1) {
    const distance = 8 - ray;
    const angle =
      baseAngle + (Math.PI * 2 * ray) / RAY_COUNT + (Math.random() - 0.5) * 0.42;
    const end = {
      x: Math.floor(center.x + Math.cos(angle) * distance),
      y: floorY,
      z: Math.floor(center.z + Math.sin(angle) * distance)
    };
    endpoints.push(end);
    const points = Math.max(2, distance * 2);
    for (let point = 1; point < points - 1; point += 1) {
      const t = point / (points - 1);
      const location = {
        x: Math.floor(center.x + (end.x - center.x) * t),
        y: floorY,
        z: Math.floor(center.z + (end.z - center.z) * t)
      };
      const key = `${location.x}:${location.y}:${location.z}`;
      if (used.has(key)) {
        continue;
      }
      used.add(key);
      setRewardBlock(dimension, location, "minecraft:netherrack");
      spawnGauntletParticle(dimension, "bomd:gauntlet_spark", {
        x: location.x + 0.5,
        y: location.y + 1.05,
        z: location.z + 0.5
      });
    }
  }

  // Endpoints are written last so every ray always ends in ancient debris,
  // even when two rounded paths cross.
  for (const endpoint of endpoints) {
    setRewardBlock(dimension, endpoint, "minecraft:ancient_debris");
    spawnGauntletParticle(dimension, "bomd:gauntlet_spark", {
      x: endpoint.x + 0.5,
      y: endpoint.y + 1.05,
      z: endpoint.z + 0.5
    });
  }
}

function fillRewardChest(dimension, location) {
  if (!setRewardBlock(dimension, location, "minecraft:chest")) {
    return false;
  }
  const container = dimension
    .getBlock(location)
    ?.getComponent("minecraft:inventory")?.container;
  if (!container) {
    return false;
  }
  container.clearAll();

  const manager = world.getLootTableManager();
  const table = manager.getLootTable(CHEST_LOOT_TABLE);
  if (table) {
    for (const stack of manager.generateLootFromTable(table) ?? []) {
      container.addItem(stack);
    }
    return true;
  }

  // Fallback protects the reward if a future engine changes the loot manager.
  container.addItem(new ItemStack("bomd:blazing_eye", 1));
  console.warn("[BOMD] Gauntlet chest loot table missing; used direct Blazing Eye fallback.");
  return true;
}

function distributeExperience(dimension, center) {
  const perPulse = TOTAL_EXPERIENCE / EXPERIENCE_PULSES;
  for (let pulse = 0; pulse < EXPERIENCE_PULSES; pulse += 1) {
    schedule(
      pulse + 1,
      () => {
        const players = dimension.getPlayers({
          location: center,
          maxDistance: 64
        });
        let collector;
        let best = Number.POSITIVE_INFINITY;
        for (const player of players) {
          const dx = player.location.x - center.x;
          const dy = player.location.y - center.y;
          const dz = player.location.z - center.z;
          const squared = dx * dx + dy * dy + dz * dz;
          if (squared < best) {
            collector = player;
            best = squared;
          }
        }
        if (collector) {
          attempt(
            () => collector.addExperience(perPulse),
            "grant Nether Gauntlet experience"
          );
        }
        spawnGauntletParticle(dimension, "minecraft:basic_portal_particle", {
          x: center.x + (Math.random() - 0.5) * 2,
          y: center.y + 0.6 + Math.random() * 1.6,
          z: center.z + (Math.random() - 0.5) * 2
        });
      },
      "distribute Nether Gauntlet experience"
    );
  }
}

export function createGauntletDeathReward(dimension, deathLocation, delayTicks = 50) {
  const center = {
    x: Math.floor(deathLocation.x),
    y: Math.floor(deathLocation.y),
    z: Math.floor(deathLocation.z)
  };
  const buildReward = (retry = 0) => {
      if (!isLocationLoaded(dimension, deathLocation)) {
        if (retry < 60) schedule(20, () => buildReward(retry + 1), "resume Nether Gauntlet death reward");
        return;
      }
      const floorY = findFloorY(dimension, deathLocation);
      attempt(
        () => dimension.createExplosion(
          { x: deathLocation.x, y: floorY + 1, z: deathLocation.z },
          4,
          { breaksBlocks: false, causesFire: false, allowUnderwater: true }
        ),
        "create controlled Nether Gauntlet death explosion"
      );
      createAncientDebrisTrails(dimension, center, floorY);
      const chestLocation = { x: center.x, y: floorY + 1, z: center.z };
      fillRewardChest(dimension, chestLocation);
      distributeExperience(dimension, {
        x: center.x + 0.5,
        y: floorY + 1.2,
        z: center.z + 0.5
      });
      spawnGauntletBurst(
        dimension,
        { x: center.x + 0.5, y: floorY + 1.2, z: center.z + 0.5 },
        64,
        3.0
      );
      playGauntletSound(
        dimension,
        "bomd.nether_gauntlet.death",
        chestLocation,
        1.4,
        0.82
      );
      world.sendMessage(translate("bomd.message.gauntlet.reward_created"));
  };
  schedule(delayTicks, () => buildReward(), "create Nether Gauntlet death reward");
}
