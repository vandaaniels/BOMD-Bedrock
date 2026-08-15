// @ts-check

import { system, world } from "@minecraft/server";
import {
  VOID_BLOSSOM_ANCHOR_TYPE,
  VOID_BLOSSOM_TYPE,
  VOID_CAVERN_DEFEATED_PROPERTY,
  VOID_CAVERN_LOCATOR_SEED_PROPERTY,
  VOID_CAVERN_PLANNED_PROPERTY,
  VOID_CAVERN_SEED_BLOCK,
  VOID_POLLEN_PARTICLE
} from "../core/config.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import { horizontalDistance, normalize, subtract } from "../core/vector.js";
import { playSound, spawnParticle } from "../visuals/frost.js";

const REGION_SIZE = 1024;
const CHUNK_SPREAD = 40;
const MAX_SAVED_LOCATIONS = 64;
// Java builds this cavern from the Overworld minimum Y (-64) up to -32.
// The previous -29 origin shifted the entire encounter 35 blocks upward.
const CAVERN_ORIGIN_Y = -64;
const MATERIALIZE_DISTANCE = 24;
const GLOW_VINE_SCAN_MIN_Y = 19;
const GLOW_VINE_SCAN_MAX_Y = 31;
const GLOW_VINE_BATCH_SIZE = 6;
const GLOW_VINE_GRID_STEP = 8;
let materializerStarted = false;

function deterministicVineLength(x, z) {
  const mixed = mix32(Math.imul(x + 73, 0x45d9f3b) ^ Math.imul(z - 41, 0x27d4eb2d));
  return 2 + (mixed % 4);
}

function luminousVineColumns() {
  const columns = [];
  for (let x = 6; x <= 58; x += GLOW_VINE_GRID_STEP) {
    for (let z = 6; z <= 58; z += GLOW_VINE_GRID_STEP) {
      // Keep the immediate boss silhouette readable instead of putting vines
      // directly through the central flower.
      const dx = x - 32;
      const dz = z - 32;
      if (dx * dx + dz * dz < 70) continue;
      columns.push({ x, z, length: deterministicVineLength(x, z) });
    }
  }
  return columns;
}

function placeGlowVineColumn(dimension, origin, definition) {
  const x = origin.x + definition.x;
  const z = origin.z + definition.z;
  let ceilingY;

  for (let relativeY = GLOW_VINE_SCAN_MAX_Y; relativeY >= GLOW_VINE_SCAN_MIN_Y; relativeY -= 1) {
    const location = { x, y: origin.y + relativeY, z };
    const block = attempt(
      () => dimension.getBlock(location),
      "scan Void Cavern moss ceiling"
    );
    if (block?.typeId !== "minecraft:moss_block") continue;
    const below = attempt(
      () => dimension.getBlock({ x, y: location.y - 1, z }),
      "check Void Cavern vine clearance"
    );
    if (below?.typeId === "minecraft:air") {
      ceilingY = location.y;
      break;
    }
  }
  if (ceilingY === undefined) return;

  const requestedLength = definition.length;
  let placed = 0;
  for (let offset = 1; offset <= requestedLength; offset += 1) {
    const location = { x, y: ceilingY - offset, z };
    const block = attempt(
      () => dimension.getBlock(location),
      "read Void Cavern vine position"
    );
    if (block?.typeId !== "minecraft:air") break;

    const last = offset === requestedLength;
    const typeId = last
      ? "minecraft:cave_vines_head_with_berries"
      : offset % 2 === 1
        ? "minecraft:cave_vines_body_with_berries"
        : "minecraft:cave_vines";
    if (attempt(
      () => {
        dimension.setBlockType(location, typeId);
        return true;
      },
      `place Void Cavern ${typeId}`
    ) !== true) break;
    placed += 1;
  }

  // If obstruction shortened the chain, make its lowest surviving segment a
  // berry-bearing head so every successful column remains a real light source.
  if (placed > 0 && placed < requestedLength) {
    attempt(
      () => dimension.setBlockType(
        { x, y: ceilingY - placed, z },
        "minecraft:cave_vines_head_with_berries"
      ),
      "finish shortened Void Cavern glow vine"
    );
  }
}

function decorateVoidCavernLighting(dimension, origin) {
  const columns = luminousVineColumns();
  for (let start = 0; start < columns.length; start += GLOW_VINE_BATCH_SIZE) {
    const batch = columns.slice(start, start + GLOW_VINE_BATCH_SIZE);
    system.runTimeout(() => {
      for (const definition of batch) {
        placeGlowVineColumn(dimension, origin, definition);
      }
    }, 1 + Math.floor(start / GLOW_VINE_BATCH_SIZE));
  }
}

function blockLocationIsLoaded(dimension, location) {
  try {
    return dimension.getBlock(location) !== undefined;
  } catch {
    return false;
  }
}

function cavernFootprintIsLoaded(dimension, origin, center) {
  const y = Math.floor(center.y);
  return [
    { x: Math.floor(center.x), y, z: Math.floor(center.z) },
    { x: origin.x, y, z: origin.z },
    { x: origin.x + 64, y, z: origin.z },
    { x: origin.x, y, z: origin.z + 64 },
    { x: origin.x + 64, y, z: origin.z + 64 }
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

export function voidCavernCandidateForRegion(regionX, regionZ, seed) {
  const xHash = mix32(
    seed ^ Math.imul(regionX, 0x6ac690c5) ^ Math.imul(regionZ, 0x27d4eb2d)
  );
  const zHash = mix32(
    seed ^ Math.imul(regionX, 0x1f123bb5) ^ Math.imul(regionZ, 0x5bd1e995)
  );
  return {
    x: regionX * REGION_SIZE + positiveMod(xHash, CHUNK_SPREAD) * 16 + 8,
    y: CAVERN_ORIGIN_Y + 5,
    z: regionZ * REGION_SIZE + positiveMod(zHash, CHUNK_SPREAD) * 16 + 8
  };
}

function readLocations(propertyId) {
  const value = attempt(() => world.getDynamicProperty(propertyId), `read ${propertyId}`);
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry) => Number.isFinite(entry?.x) && Number.isFinite(entry?.z))
      : [];
  } catch {
    return [];
  }
}

function writeLocations(propertyId, locations) {
  world.setDynamicProperty(
    propertyId,
    JSON.stringify(locations.slice(-MAX_SAVED_LOCATIONS))
  );
}

function locatorSeed() {
  const value = attempt(
    () => world.getDynamicProperty(VOID_CAVERN_LOCATOR_SEED_PROPERTY),
    "read Void Cavern locator seed"
  );
  if (typeof value === "number") return value | 0;
  const generated = Math.floor(Math.random() * 0x7fffffff);
  world.setDynamicProperty(VOID_CAVERN_LOCATOR_SEED_PROPERTY, generated);
  return generated;
}

function key(location) {
  return `${Math.floor(location.x)},${Math.floor(location.z)}`;
}

function ensureMarker(candidate) {
  const planned = readLocations(VOID_CAVERN_PLANNED_PROPERTY);
  if (planned.some((entry) => key(entry) === key(candidate))) return true;
  writeLocations(VOID_CAVERN_PLANNED_PROPERTY, [...planned, candidate]);
  return true;
}

export function planNearestVoidCavern(location) {
  const seed = locatorSeed();
  const defeated = readLocations(VOID_CAVERN_DEFEATED_PROPERTY);
  const centerX = Math.floor(location.x / REGION_SIZE);
  const centerZ = Math.floor(location.z / REGION_SIZE);
  const candidates = [];
  for (let x = -2; x <= 2; x += 1) {
    for (let z = -2; z <= 2; z += 1) {
      const candidate = voidCavernCandidateForRegion(centerX + x, centerZ + z, seed);
      if (!defeated.some((entry) => horizontalDistance(entry, candidate) <= 64)) {
        candidates.push(candidate);
      }
    }
  }
  candidates.sort(
    (left, right) => horizontalDistance(left, location) - horizontalDistance(right, location)
  );
  for (const candidate of candidates) {
    if (ensureMarker(candidate)) return candidate;
  }
  return undefined;
}

function nearestLoadedCavern(location) {
  const dimension = world.getDimension("overworld");
  const anchors = attempt(
    () => dimension.getEntities({
      type: VOID_BLOSSOM_ANCHOR_TYPE,
      location,
      maxDistance: 4096
    }),
    "find loaded Void Blossom caverns"
  ) ?? [];
  return anchors
    .filter((anchor) => anchor.getDynamicProperty("bomd:void_defeated") !== true)
    .sort((a, b) => horizontalDistance(a.location, location) - horizontalDistance(b.location, location))[0]
    ?.location;
}

export function nearestVoidCavernTarget(location) {
  return nearestLoadedCavern(location) ?? planNearestVoidCavern(location);
}

export function recordVoidCavernDefeated(dimension, location) {
  const anchors = attempt(
    () => dimension.getEntities({
      type: VOID_BLOSSOM_ANCHOR_TYPE,
      location,
      maxDistance: 48
    }),
    "find defeated Void Blossom cavern anchor"
  ) ?? [];
  const anchor = anchors.sort(
    (a, b) => horizontalDistance(a.location, location) - horizontalDistance(b.location, location)
  )[0];
  if (isEntityUsable(anchor)) anchor.setDynamicProperty("bomd:void_defeated", true);
  const defeated = readLocations(VOID_CAVERN_DEFEATED_PROPERTY);
  if (defeated.some((entry) => horizontalDistance(entry, location) <= 32)) return;
  writeLocations(VOID_CAVERN_DEFEATED_PROPERTY, [
    ...defeated,
    { x: location.x, z: location.z }
  ]);
}

function fillCavernChest(dimension, location) {
  const block = dimension.getBlock(location);
  const container = block?.getComponent("minecraft:inventory")?.container;
  if (!container || container.emptySlotsCount < container.size) return;
  const table = world.getLootTableManager().getLootTable(
    "bomd/void_blossom/cavern_chest"
  );
  if (!table) return;
  for (const stack of world.getLootTableManager().generateLootFromTable(table) ?? []) {
    container.addItem(stack);
  }
}

function materializeCavernAt(dimension, center) {
  const origin = {
    x: Math.floor(center.x) - 32,
    y: CAVERN_ORIGIN_Y,
    z: Math.floor(center.z) - 32
  };
  if (!cavernFootprintIsLoaded(dimension, origin, center)) return false;

  let anchor = dimension.getEntities({
    type: VOID_BLOSSOM_ANCHOR_TYPE,
    location: center,
    maxDistance: 48
  })[0];
  let newlyPlaced = false;
  if (!isEntityUsable(anchor)) {
    const placed = attempt(() => {
      world.structureManager.place(
        "bomd:void_blossom_cavern",
        dimension,
        origin
      );
      return true;
    }, "materialize Void Blossom cavern") === true;
    if (!placed) return false;
    newlyPlaced = true;
    anchor = attempt(
      () => dimension.spawnEntity(VOID_BLOSSOM_ANCHOR_TYPE, center),
      "spawn Void Cavern anchor"
    );
    if (!isEntityUsable(anchor)) return false;
    anchor.nameTag = "Void Blossom Cavern";
    anchor.setDynamicProperty("bomd:void_defeated", false);
  }

  const defeated = anchor.getDynamicProperty("bomd:void_defeated") === true;
  let boss = dimension.getEntities({
    type: VOID_BLOSSOM_TYPE,
    location: center,
    maxDistance: 48
  })[0];
  if (!defeated && !isEntityUsable(boss)) {
    boss = attempt(
      () => dimension.spawnEntity(VOID_BLOSSOM_TYPE, center),
      "spawn Void Blossom from cavern"
    );
    if (!isEntityUsable(boss)) return false;
    boss.nameTag = "Void Blossom";
  }

  fillCavernChest(dimension, {
    x: origin.x + 42,
    y: origin.y + 5,
    z: origin.z + 32
  });
  if (newlyPlaced) {
    decorateVoidCavernLighting(dimension, origin);
    playSound(dimension, "bomd.void_blossom.wave_indicator", center, 2, 0.7);
  }
  return true;
}

function materializeNearbyPlannedCaverns() {
  const planned = readLocations(VOID_CAVERN_PLANNED_PROPERTY);
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
      !materializeCavernAt(overworld, candidate)
    ) {
      remaining.push(candidate);
    }
  }
  if (remaining.length !== planned.length) {
    writeLocations(VOID_CAVERN_PLANNED_PROPERTY, remaining);
  }
}

function materializeCavern(event) {
  const marker = event.block;
  if (
    marker.typeId !== VOID_CAVERN_SEED_BLOCK ||
    event.dimension.id !== "minecraft:overworld"
  ) return;
  const center = {
    x: marker.location.x,
    y: CAVERN_ORIGIN_Y + 5,
    z: marker.location.z
  };
  if (materializeCavernAt(event.dimension, center)) {
    attempt(() => marker.setType("minecraft:air"), "consume Void Cavern seed");
  }
}

function directionName(from, to) {
  const angle = (Math.atan2(to.z - from.z, to.x - from.x) * 180) / Math.PI;
  const directions = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  return directions[Math.round(((angle + 360) % 360) / 45) % directions.length];
}

function tickVoidLily(event) {
  if (event.dimension.id !== "minecraft:overworld") return;
  const target = nearestVoidCavernTarget(event.block.location);
  if (!target) return;
  const start = {
    x: event.block.location.x + 0.5,
    y: event.block.location.y + 0.75,
    z: event.block.location.z + 0.5
  };
  const direction = normalize(subtract(target, start));
  const right = normalize({ x: -direction.z, y: 0, z: direction.x });
  for (let index = 0; index < 8; index += 1) {
    const progress = index / 7;
    const curve = Math.sin(progress * Math.PI * 3) * 0.13;
    spawnParticle(event.dimension, VOID_POLLEN_PARTICLE, {
      x: start.x + direction.x * progress * 1.5 + right.x * curve,
      y: start.y + progress * 0.25,
      z: start.z + direction.z * progress * 1.5 + right.z * curve
    });
  }
}

function decorateVoidCavernFromCommand(event) {
  if (event.id !== "bomd:decorate_void_cavern") return;
  const source = event.sourceEntity;
  if (!isEntityUsable(source) || source.typeId !== "minecraft:player") return;
  if (source.dimension.id !== "minecraft:overworld") return;
  const origin = {
    x: Math.floor(source.location.x) - 32,
    y: CAVERN_ORIGIN_Y,
    z: Math.floor(source.location.z) - 32
  };
  decorateVoidCavernLighting(source.dimension, origin);
}

function interactVoidLily(event) {
  const player = event.player;
  if (!isEntityUsable(player)) return;
  if (player.dimension.id !== "minecraft:overworld") {
    player.onScreenDisplay.setActionBar("§5The Void Lily only responds in the Overworld");
    return;
  }
  const target = nearestVoidCavernTarget(event.block.location);
  if (!target) {
    player.onScreenDisplay.setActionBar("§cThe Void Lily cannot find a cavern");
    return;
  }
  const range = Math.round(horizontalDistance(event.block.location, target));
  playSound(
    player.dimension,
    "bomd.void_blossom.spore_prepare",
    event.block.location,
    0.65,
    1.35
  );
  player.onScreenDisplay.setActionBar(
    `§dThe pollen points ${directionName(event.block.location, target)} §7— §f${range} blocks`
  );
}

export function registerVoidCavernComponents(blockComponentRegistry) {
  blockComponentRegistry.registerCustomComponent("bomd:void_cavern_seed", {
    onTick: materializeCavern
  });
  blockComponentRegistry.registerCustomComponent("bomd:void_lily_locator", {
    onTick: tickVoidLily,
    onPlayerInteract: interactVoidLily
  });
  if (!materializerStarted) {
    materializerStarted = true;
    system.afterEvents.scriptEventReceive.subscribe(decorateVoidCavernFromCommand);
    system.runInterval(materializeNearbyPlannedCaverns, 40);
  }
}
