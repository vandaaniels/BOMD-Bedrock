// @ts-check

import { system, world } from "@minecraft/server";
import {
  ANCHOR_TYPE,
  TOWER_DEFEATED_LOCATIONS_PROPERTY,
  TOWER_PLANNED_PROPERTY,
  TOWER_SEED_BLOCK,
  TOWER_LOCATOR_SEED_PROPERTY
} from "../core/config.js";
import { attempt } from "../core/safe.js";
import { horizontalDistance } from "../core/vector.js";

const REGION_SIZE = 1600;
const CHUNK_SPREAD = 50;
const MAX_SAVED_LOCATIONS = 64;
const MATERIALIZE_DISTANCE = 24;
let materializerStarted = false;

function blockLocationIsLoaded(dimension, location) {
  try {
    return dimension.getBlock(location) !== undefined;
  } catch {
    return false;
  }
}

function towerFootprintIsLoaded(dimension, center) {
  const originX = Math.floor(center.x) - 16;
  const originZ = Math.floor(center.z) - 14;
  return [
    { x: Math.floor(center.x), y: 0, z: Math.floor(center.z) },
    { x: originX, y: 0, z: originZ },
    { x: originX + 29, y: 0, z: originZ },
    { x: originX, y: 0, z: originZ + 29 },
    { x: originX + 29, y: 0, z: originZ + 29 }
  ].every((location) => blockLocationIsLoaded(dimension, location));
}

function positiveMod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function mix32(value) {
  let mixed = value | 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

export function towerCandidateForRegion(regionX, regionZ, seed) {
  const xHash = mix32(
    seed ^ Math.imul(regionX, 0x1f123bb5) ^ Math.imul(regionZ, 0x6ac690c5)
  );
  const zHash = mix32(
    seed ^ Math.imul(regionX, 0x5bd1e995) ^ Math.imul(regionZ, 0x27d4eb2d)
  );
  return {
    x:
      regionX * REGION_SIZE +
      positiveMod(xHash, CHUNK_SPREAD) * 16 + 8,
    y: 96,
    z:
      regionZ * REGION_SIZE +
      positiveMod(zHash, CHUNK_SPREAD) * 16 + 8
  };
}

function readLocationList(propertyId) {
  const value = attempt(
    () => world.getDynamicProperty(propertyId),
    `read ${propertyId}`
  );
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry) =>
            Number.isFinite(entry?.x) && Number.isFinite(entry?.z)
        )
      : [];
  } catch {
    return [];
  }
}

function writeLocationList(propertyId, locations) {
  world.setDynamicProperty(
    propertyId,
    JSON.stringify(locations.slice(-MAX_SAVED_LOCATIONS))
  );
}

function locatorSeed() {
  const stored = attempt(
    () => world.getDynamicProperty(TOWER_LOCATOR_SEED_PROPERTY),
    "read Night Lich locator seed"
  );
  if (typeof stored === "number") {
    return stored | 0;
  }
  const generated = Math.floor(Math.random() * 0x7fffffff);
  world.setDynamicProperty(TOWER_LOCATOR_SEED_PROPERTY, generated);
  return generated;
}

function locationKey(location) {
  return `${Math.floor(location.x)},${Math.floor(location.z)}`;
}

function nearRecordedLocation(location, locations, radius = 96) {
  return locations.some(
    (entry) => horizontalDistance(location, entry) <= radius
  );
}

function ensureTowerMarker(candidate) {
  const planned = readLocationList(TOWER_PLANNED_PROPERTY);
  if (
    planned.some(
      (entry) => locationKey(entry) === locationKey(candidate)
    )
  ) {
    return true;
  }
  writeLocationList(TOWER_PLANNED_PROPERTY, [...planned, candidate]);
  return true;
}

export function planNearestNightLichTower(location) {
  const seed = locatorSeed();
  const defeated = readLocationList(
    TOWER_DEFEATED_LOCATIONS_PROPERTY
  );
  const centerRegionX = Math.floor(location.x / REGION_SIZE);
  const centerRegionZ = Math.floor(location.z / REGION_SIZE);
  const candidates = [];
  for (let x = -2; x <= 2; x += 1) {
    for (let z = -2; z <= 2; z += 1) {
      const candidate = towerCandidateForRegion(
        centerRegionX + x,
        centerRegionZ + z,
        seed
      );
      if (!nearRecordedLocation(candidate, defeated)) {
        candidates.push(candidate);
      }
    }
  }
  candidates.sort(
    (left, right) =>
      horizontalDistance(left, location) -
      horizontalDistance(right, location)
  );
  for (const candidate of candidates) {
    if (ensureTowerMarker(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function recordDefeatedTowerLocation(location) {
  const defeated = readLocationList(
    TOWER_DEFEATED_LOCATIONS_PROPERTY
  );
  if (nearRecordedLocation(location, defeated, 32)) {
    return;
  }
  writeLocationList(
    TOWER_DEFEATED_LOCATIONS_PROPERTY,
    [...defeated, { x: location.x, z: location.z }]
  );
}

function surfaceForTower(dimension, x, z) {
  let block = attempt(
    () => dimension.getTopmostBlock({ x, z }),
    "find undiscovered Night Lich Tower surface"
  );
  for (let step = 0; block && step < 24; step += 1) {
    const typeId = block.typeId;
    if (
      !typeId.includes("leaves") &&
      !typeId.includes("log") &&
      !typeId.includes("wood") &&
      !typeId.includes("vine") &&
      typeId !== "minecraft:snow_layer"
    ) {
      return block;
    }
    block = attempt(
      () => block?.below(),
      "skip foliage above Night Lich Tower"
    );
  }
  return block;
}

function materializeTowerAt(dimension, center) {
  if (!towerFootprintIsLoaded(dimension, center)) return false;
  const anchors = attempt(
    () =>
      dimension.getEntities({
        type: ANCHOR_TYPE,
        location: { x: center.x, y: 96, z: center.z },
        maxDistance: 96
      }),
    "check planned Night Lich Tower"
  );
  if ((anchors?.length ?? 0) > 0) return true;
  const surface = surfaceForTower(
    dimension,
    Math.floor(center.x),
    Math.floor(center.z)
  );
  if (!surface) return false;
  return (
    attempt(
      () => {
        world.structureManager.place(
          "bomd:night_lich_tower",
          dimension,
          {
            x: Math.floor(center.x) - 16,
            y: surface.location.y - 8,
            z: Math.floor(center.z) - 14
          }
        );
        return true;
      },
      "materialize undiscovered Night Lich Tower"
    ) === true
  );
}

function materializeNearbyPlannedTowers() {
  const planned = readLocationList(TOWER_PLANNED_PROPERTY);
  if (planned.length === 0) return;
  const overworld = world.getDimension("overworld");
  const players = overworld.getPlayers();
  if (players.length === 0) return;
  const remaining = [];
  for (const candidate of planned) {
    const loadedByPlayer = players.some(
      (player) =>
        horizontalDistance(player.location, candidate) <=
        MATERIALIZE_DISTANCE
    );
    if (
      !loadedByPlayer ||
      !materializeTowerAt(overworld, candidate)
    ) {
      remaining.push(candidate);
    }
  }
  if (remaining.length !== planned.length) {
    writeLocationList(TOWER_PLANNED_PROPERTY, remaining);
  }
}

function materializeTowerSeed(event) {
  const marker = event.block;
  if (
    marker.typeId !== TOWER_SEED_BLOCK ||
    event.dimension.id !== "minecraft:overworld"
  ) {
    return;
  }
  const center = {
    x: marker.location.x,
    z: marker.location.z
  };
  if (materializeTowerAt(event.dimension, center)) {
    attempt(
      () => marker.setType("minecraft:air"),
      "consume Night Lich Tower seed"
    );
  }
}

export function registerTowerSeedComponent(blockComponentRegistry) {
  blockComponentRegistry.registerCustomComponent(
    "bomd:night_lich_tower_seed",
    {
      onTick: materializeTowerSeed
    }
  );
  if (!materializerStarted) {
    materializerStarted = true;
    system.runInterval(materializeNearbyPlannedTowers, 40);
  }
}
