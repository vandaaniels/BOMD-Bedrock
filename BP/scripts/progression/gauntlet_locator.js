// @ts-check

import { system, world } from "@minecraft/server";
import { isBossCombatPlayer } from "../core/combat_target.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import { horizontalDistance } from "../core/vector.js";
import { playSound } from "../visuals/frost.js";

const REGION_SIZE = 512;
const CHUNK_SPREAD = 16;
const ARENA_Y = 15;
const MATERIALIZE_DISTANCE = 48;
const MAX_LOCATIONS = 64;
const PLANNED_PROPERTY = "bomd:gauntlet_planned";
const KNOWN_PROPERTY = "bomd:gauntlet_known";
const DEFEATED_PROPERTY = "bomd:gauntlet_defeated";
const SEED_PROPERTY = "bomd:gauntlet_locator_seed";
const DISCOVERY_RANGE = 320;
const discoveryNotices = new Set();
let started = false;

function positiveMod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function mix32(value) {
  let mixed = value | 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function readLocations(propertyId) {
  const stored = attempt(
    () => world.getDynamicProperty(propertyId),
    `read ${propertyId}`
  );
  if (typeof stored !== "string" || stored.length === 0) return [];
  try {
    const parsed = JSON.parse(stored);
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
    JSON.stringify(locations.slice(-MAX_LOCATIONS))
  );
}

function locatorSeed() {
  const stored = attempt(
    () => world.getDynamicProperty(SEED_PROPERTY),
    "read Nether Gauntlet locator seed"
  );
  if (typeof stored === "number") return stored | 0;
  const generated = Math.floor(Math.random() * 0x7fffffff);
  world.setDynamicProperty(SEED_PROPERTY, generated);
  return generated;
}

function candidateForRegion(regionX, regionZ, seed) {
  const xHash = mix32(
    seed ^ Math.imul(regionX, 0x6ac690c5) ^ Math.imul(regionZ, 0x27d4eb2d)
  );
  const zHash = mix32(
    seed ^ Math.imul(regionX, 0x1f123bb5) ^ Math.imul(regionZ, 0x5bd1e995)
  );
  return {
    x: regionX * REGION_SIZE + positiveMod(xHash, CHUNK_SPREAD) * 16 + 8,
    y: ARENA_Y,
    z: regionZ * REGION_SIZE + positiveMod(zHash, CHUNK_SPREAD) * 16 + 8
  };
}

function sameLocation(left, right) {
  return Math.floor(left.x) === Math.floor(right.x) &&
    Math.floor(left.z) === Math.floor(right.z);
}

function isDefeated(location) {
  return readLocations(DEFEATED_PROPERTY).some(
    (entry) => horizontalDistance(entry, location) <= 40
  );
}

function generatedCandidates(location) {
  const seed = locatorSeed();
  const regionX = Math.floor(location.x / REGION_SIZE);
  const regionZ = Math.floor(location.z / REGION_SIZE);
  const candidates = [];
  for (let x = -1; x <= 1; x += 1) {
    for (let z = -1; z <= 1; z += 1) {
      const candidate = candidateForRegion(regionX + x, regionZ + z, seed);
      if (!isDefeated(candidate)) candidates.push(candidate);
    }
  }
  return candidates;
}

export function nearestGauntletArena(location) {
  const existing = [
    ...readLocations(KNOWN_PROPERTY),
    ...readLocations(PLANNED_PROPERTY)
  ].filter((entry) => !isDefeated(entry));
  const generated = generatedCandidates(location);
  const candidates = [...existing, ...generated].filter(
    (entry, index, entries) =>
      entries.findIndex((candidate) => sameLocation(candidate, entry)) === index
  );
  const target = candidates.sort(
    (left, right) => horizontalDistance(left, location) - horizontalDistance(right, location)
  )[0];
  if (!target) return undefined;
  const planned = readLocations(PLANNED_PROPERTY);
  if (!planned.some((entry) => sameLocation(entry, target))) {
    writeLocations(PLANNED_PROPERTY, [...planned, target]);
  }
  return target;
}

function planNaturalArenas() {
  const dimension = world.getDimension("nether");
  const players = dimension.getPlayers();
  if (players.length === 0) return;
  const planned = readLocations(PLANNED_PROPERTY);
  const known = readLocations(KNOWN_PROPERTY);
  let changed = false;
  for (const player of players) {
    for (const candidate of generatedCandidates(player.location)) {
      if (
        known.some((entry) => sameLocation(entry, candidate)) ||
        planned.some((entry) => sameLocation(entry, candidate))
      ) {
        continue;
      }
      planned.push(candidate);
      changed = true;
    }
  }
  if (changed) writeLocations(PLANNED_PROPERTY, planned);
}

export function nearestRecordedGauntletArena(location, maxDistance = 48) {
  const recorded = [
    ...readLocations(KNOWN_PROPERTY),
    ...readLocations(PLANNED_PROPERTY),
    ...readLocations(DEFEATED_PROPERTY)
  ];
  const unique = recorded.filter(
    (entry, index) =>
      recorded.findIndex((candidate) => sameLocation(candidate, entry)) === index
  );
  const target = unique.sort(
    (left, right) =>
      horizontalDistance(left, location) - horizontalDistance(right, location)
  )[0];
  return target && horizontalDistance(target, location) <= maxDistance
    ? { x: target.x, y: ARENA_Y, z: target.z }
    : undefined;
}

function footprintLoaded(dimension, center) {
  const points = [
    { x: center.x, y: ARENA_Y, z: center.z },
    { x: center.x - 24, y: ARENA_Y, z: center.z - 24 },
    { x: center.x + 24, y: ARENA_Y, z: center.z - 24 },
    { x: center.x - 24, y: ARENA_Y, z: center.z + 24 },
    { x: center.x + 24, y: ARENA_Y, z: center.z + 24 }
  ];
  return points.every((point) => {
    try {
      return dimension.getBlock(point) !== undefined;
    } catch {
      return false;
    }
  });
}

function materializePlannedArenas() {
  const dimension = world.getDimension("nether");
  const players = dimension.getPlayers();
  if (players.length === 0) return;
  const planned = readLocations(PLANNED_PROPERTY);
  if (planned.length === 0) return;
  const remaining = [];
  const known = readLocations(KNOWN_PROPERTY);
  for (const target of planned) {
    const nearby = players.some(
      (player) => horizontalDistance(player.location, target) <= MATERIALIZE_DISTANCE
    );
    if (!nearby || !footprintLoaded(dimension, target)) {
      remaining.push(target);
      continue;
    }
    const placed = attempt(() => {
      world.structureManager.place("bomd:gauntlet_arena", dimension, {
        x: Math.floor(target.x) - 23,
        y: ARENA_Y,
        z: Math.floor(target.z) - 23
      });
      return true;
    }, "materialize located Nether Gauntlet arena") === true;
    if (!placed) {
      remaining.push(target);
      continue;
    }
    if (!known.some((entry) => sameLocation(entry, target))) known.push(target);
    playSound(dimension, "bomd.nether_gauntlet.cast", target, 2.2, 0.72);
  }
  writeLocations(PLANNED_PROPERTY, remaining);
  writeLocations(KNOWN_PROPERTY, known);
}

function directionName(from, to) {
  const angle = (Math.atan2(to.z - from.z, to.x - from.x) * 180) / Math.PI;
  const directions = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  return directions[Math.round(((angle + 360) % 360) / 45) % directions.length];
}

function naturalDiscoveryHints() {
  const dimension = world.getDimension("nether");
  for (const player of dimension.getPlayers().filter(isBossCombatPlayer)) {
    const target = nearestGauntletArena(player.location);
    if (!target) continue;
    const range = Math.round(horizontalDistance(player.location, target));
    if (range > DISCOVERY_RANGE) continue;
    const direction = directionName(player.location, target);
    const key = `${player.id}:${Math.floor(target.x)},${Math.floor(target.z)}`;
    player.onScreenDisplay.setActionBar({
      translate: "message.bomd.gauntlet_resonance.actionbar",
      with: [direction, String(range), String(ARENA_Y)]
    });
    if (discoveryNotices.has(key)) continue;
    discoveryNotices.add(key);
    player.sendMessage({
      translate: "message.bomd.gauntlet_resonance",
      with: [direction, String(ARENA_Y)]
    });
    playSound(dimension, "bomd.nether_gauntlet.idle", player.location, 0.75, 0.55);
  }
}

function locateFromCommand(event) {
  if (event.id !== "bomd:locate") return;
  const requested = event.message.trim().toLowerCase();
  if (requested !== "gauntlet" && requested !== "nether_gauntlet") return;
  const player = event.sourceEntity;
  if (!isEntityUsable(player) || player.typeId !== "minecraft:player") return;
  if (player.dimension.id !== "minecraft:nether") {
    player.sendMessage("§c[BOMD] The Nether Gauntlet can only be located from the Nether.");
    return;
  }
  const target = nearestGauntletArena(player.location);
  if (!target) {
    player.sendMessage("§c[BOMD] No Nether Gauntlet arena location could be reserved.");
    return;
  }
  const range = Math.round(horizontalDistance(player.location, target));
  player.sendMessage(
    `§4[BOMD] §fNether Gauntlet arena: §6X ${Math.floor(target.x)}, Y ${ARENA_Y}, Z ${Math.floor(target.z)} §7(${directionName(player.location, target)}, ${range} blocks).`
  );
  player.onScreenDisplay.setActionBar(
    `§6Gauntlet: ${directionName(player.location, target)} §7— §f${range} blocks, Y ${ARENA_Y}`
  );
  playSound(player.dimension, "random.bow", player.location, 0.8, 0.55);
}

export function recordGauntletArenaDefeated(location) {
  const defeated = readLocations(DEFEATED_PROPERTY);
  if (defeated.some((entry) => horizontalDistance(entry, location) <= 40)) return;
  writeLocations(DEFEATED_PROPERTY, [...defeated, { x: location.x, z: location.z }]);
}

export function recordGauntletArenaRepaired(location) {
  writeLocations(
    DEFEATED_PROPERTY,
    readLocations(DEFEATED_PROPERTY).filter(
      (entry) => horizontalDistance(entry, location) > 40
    )
  );
  const known = readLocations(KNOWN_PROPERTY);
  if (!known.some((entry) => sameLocation(entry, location))) {
    writeLocations(KNOWN_PROPERTY, [...known, location]);
  }
}

export function registerGauntletLocator() {
  if (started) return;
  started = true;
  system.afterEvents.scriptEventReceive.subscribe(locateFromCommand);
  // Delay the first world/dimension read until the first fully loaded tick.
  system.runTimeout(planNaturalArenas, 1);
  system.runInterval(planNaturalArenas, 100);
  system.runInterval(materializePlannedArenas, 40);
  system.runInterval(naturalDiscoveryHints, 100);
}
