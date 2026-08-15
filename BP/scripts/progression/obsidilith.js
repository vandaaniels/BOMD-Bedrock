// @ts-check

import { system, world } from "@minecraft/server";
import {
  OBSIDILITH_ARENA_STRUCTURE,
  OBSIDILITH_DEFEATED_PROPERTY,
  OBSIDILITH_END_FRAME_BLOCK,
  OBSIDILITH_KNOWN_PROPERTY,
  OBSIDILITH_LOCATOR_SEED_PROPERTY,
  OBSIDILITH_PILLAR_RUNE_PARTICLE,
  OBSIDILITH_PILLAR_SPAWN_PARTICLE,
  OBSIDILITH_PLANNED_PROPERTY,
  OBSIDILITH_RIFT_INDICATOR_PARTICLE,
  OBSIDILITH_TYPE
} from "../core/config.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import { horizontalDistance } from "../core/vector.js";
import { consumeSelectedItem, isCreative } from "./inventory.js";
import { playSound, spawnBurst, spawnParticle } from "../visuals/frost.js";

const REGION_SIZE = 64 * 16;
const CELL_SPREAD = 32;
const ARENA_ORIGIN_Y = 90;
const TOP_OFFSET_Y = 46;
const MAX_LOCATIONS = 64;
const DISCOVERY_RANGE = 512;
const OUTER_END_MIN_RADIUS = 768;
const discoveryNotices = new Set();
const activeRituals = new Map();
const arenaPlacementJobs = new Map();
const ARENA_SIZE = 33;
const ARENA_PART_SPAN = 6;
const ARENA_PART_INTERVAL_TICKS = 2;
const ARENA_MATERIALIZE_DISTANCE = 80;
const ARENA_PARTS = [];
for (let x = 0; x < ARENA_SIZE; x += ARENA_PART_SPAN) {
  for (let z = 0; z < ARENA_SIZE; z += ARENA_PART_SPAN) {
    const width = Math.min(ARENA_PART_SPAN, ARENA_SIZE - x);
    const depth = Math.min(ARENA_PART_SPAN, ARENA_SIZE - z);
    ARENA_PARTS.push({
      x,
      z,
      width,
      depth,
      id: `bomd:obsidilith_parts/obsidilith_arena_x${String(x).padStart(2, "0")}_z${String(z).padStart(2, "0")}`
    });
  }
}
ARENA_PARTS.sort((left, right) => {
  const center = (ARENA_SIZE - 1) * 0.5;
  const leftDistance = Math.hypot(left.x + left.width * 0.5 - center, left.z + left.depth * 0.5 - center);
  const rightDistance = Math.hypot(right.x + right.width * 0.5 - center, right.z + right.depth * 0.5 - center);
  return leftDistance - rightDistance;
});
let registered = false;

function isArenaPlayer(player) {
  return isEntityUsable(player) && player.typeId === "minecraft:player";
}

function placeFullArena(dimension, origin) {
  return attempt(() => {
    world.structureManager.place(OBSIDILITH_ARENA_STRUCTURE, dimension, origin, {
      includeBlocks: true,
      includeEntities: false
    });
    return true;
  }, "place full Obsidilith arena fallback") === true;
}

function mix32(value) {
  let mixed = value | 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function positiveMod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function readLocations(propertyId) {
  const stored = attempt(() => world.getDynamicProperty(propertyId), `read ${propertyId}`);
  if (typeof stored !== "string" || stored.length === 0) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((entry) => Number.isFinite(entry?.x) && Number.isFinite(entry?.z)) : [];
  } catch {
    return [];
  }
}

function writeLocations(propertyId, locations) {
  world.setDynamicProperty(propertyId, JSON.stringify(locations.slice(-MAX_LOCATIONS)));
}

function seed() {
  const stored = world.getDynamicProperty(OBSIDILITH_LOCATOR_SEED_PROPERTY);
  if (typeof stored === "number") return stored | 0;
  const generated = Math.floor(Math.random() * 0x7fffffff);
  world.setDynamicProperty(OBSIDILITH_LOCATOR_SEED_PROPERTY, generated);
  return generated;
}

function candidateForRegion(regionX, regionZ) {
  const value = seed();
  const xHash = mix32(value ^ Math.imul(regionX, 0x6ac690c5) ^ Math.imul(regionZ, 0x27d4eb2d));
  const zHash = mix32(value ^ Math.imul(regionX, 0x1f123bb5) ^ Math.imul(regionZ, 0x5bd1e995));
  return {
    x: regionX * REGION_SIZE + positiveMod(xHash, CELL_SPREAD) * 16 + 8,
    y: ARENA_ORIGIN_Y,
    z: regionZ * REGION_SIZE + positiveMod(zHash, CELL_SPREAD) * 16 + 8
  };
}

function sameLocation(left, right) {
  return Math.floor(left.x) === Math.floor(right.x) && Math.floor(left.z) === Math.floor(right.z);
}

function defeated(location) {
  return readLocations(OBSIDILITH_DEFEATED_PROPERTY).some((entry) => horizontalDistance(entry, location) < 48);
}

function planCandidates(location) {
  const regionX = Math.floor(location.x / REGION_SIZE);
  const regionZ = Math.floor(location.z / REGION_SIZE);
  const result = [];
  for (let x = -1; x <= 1; x += 1) {
    for (let z = -1; z <= 1; z += 1) {
      const candidate = candidateForRegion(regionX + x, regionZ + z);
      if (
        horizontalDistance(candidate, { x: 0, z: 0 }) >= OUTER_END_MIN_RADIUS &&
        !defeated(candidate)
      ) result.push(candidate);
    }
  }
  return result;
}

export function nearestObsidilithArena(location) {
  const known = [...readLocations(OBSIDILITH_KNOWN_PROPERTY), ...readLocations(OBSIDILITH_PLANNED_PROPERTY), ...planCandidates(location)];
  const unique = known.filter((entry, index, entries) => entries.findIndex((candidate) => sameLocation(candidate, entry)) === index);
  const target = unique.sort((a, b) => horizontalDistance(a, location) - horizontalDistance(b, location))[0];
  if (!target) return undefined;
  const planned = readLocations(OBSIDILITH_PLANNED_PROPERTY);
  if (!planned.some((entry) => sameLocation(entry, target))) writeLocations(OBSIDILITH_PLANNED_PROPERTY, [...planned, target]);
  return { x: target.x, y: target.y + TOP_OFFSET_Y, z: target.z };
}

export function nearestRecordedObsidilithArena(location, maxDistance = 48) {
  const recorded = [...readLocations(OBSIDILITH_KNOWN_PROPERTY), ...readLocations(OBSIDILITH_DEFEATED_PROPERTY)];
  const target = recorded.sort((a, b) => horizontalDistance(a, location) - horizontalDistance(b, location))[0];
  if (!target || horizontalDistance(target, location) > maxDistance) return undefined;
  return { x: target.x, y: (target.y ?? ARENA_ORIGIN_Y) + TOP_OFFSET_Y, z: target.z };
}

function arenaOrigin(target) {
  return {
    x: Math.floor(target.x) - 16,
    y: Number.isFinite(target.y) ? Math.floor(target.y) : ARENA_ORIGIN_Y,
    z: Math.floor(target.z) - 16
  };
}

export function queueObsidilithArenaPlacement(dimension, target, onComplete) {
  const origin = arenaOrigin(target);
  const key = `${dimension.id}:${Math.floor(target.x)},${Math.floor(target.y ?? ARENA_ORIGIN_Y)},${Math.floor(target.z)}`;
  const running = arenaPlacementJobs.get(key);
  if (running) {
    if (typeof onComplete === "function") running.callbacks.push(onComplete);
    return true;
  }

  const job = {
    index: 0,
    failedAttempts: 0,
    runId: 0,
    callbacks: typeof onComplete === "function" ? [onComplete] : []
  };
  const finish = (success) => {
    if (job.runId) system.clearRun(job.runId);
    arenaPlacementJobs.delete(key);
    for (const callback of job.callbacks) {
      attempt(() => callback(success), "finish Obsidilith arena placement");
    }
  };

  // StructureManager.place already queues unloaded chunks for loading. Do not gate
  // placement on Dimension.getBlock(), because that prevents remote/Creative
  // locator tests from ever materializing the arena.
  job.runId = system.runInterval(() => {
    const part = ARENA_PARTS[job.index];
    if (!part) {
      finish(true);
      return;
    }

    const pieceOrigin = {
      x: origin.x + part.x,
      y: origin.y,
      z: origin.z + part.z
    };

    const placed = attempt(() => {
      world.structureManager.place(part.id, dimension, pieceOrigin, {
        includeBlocks: true,
        includeEntities: false
      });
      return true;
    }, `place Obsidilith arena piece ${job.index + 1}/${ARENA_PARTS.length}`) === true;

    if (!placed) {
      job.failedAttempts += 1;
      if (job.failedAttempts >= 3) {
        console.warn(`[BOMD][Obsidilith] Piece placement failed repeatedly at ${pieceOrigin.x},${pieceOrigin.y},${pieceOrigin.z}; trying the original arena structure.`);
        finish(placeFullArena(dimension, origin));
      }
      return;
    }

    job.failedAttempts = 0;
    job.index += 1;
  }, ARENA_PART_INTERVAL_TICKS);
  arenaPlacementJobs.set(key, job);
  return true;
}

function recordMaterializedArena(target) {
  const known = readLocations(OBSIDILITH_KNOWN_PROPERTY);
  if (!known.some((entry) => sameLocation(entry, target))) {
    writeLocations(OBSIDILITH_KNOWN_PROPERTY, [...known, target]);
  }
  const planned = readLocations(OBSIDILITH_PLANNED_PROPERTY);
  if (planned.some((entry) => sameLocation(entry, target))) {
    writeLocations(
      OBSIDILITH_PLANNED_PROPERTY,
      planned.filter((entry) => !sameLocation(entry, target))
    );
  }
}

function materializePlannedArenas() {
  const dimension = world.getDimension("the_end");
  const players = dimension.getPlayers().filter(isArenaPlayer);
  if (players.length === 0) return;
  const planned = readLocations(OBSIDILITH_PLANNED_PROPERTY);
  for (const target of planned) {
    if (!players.some((player) => horizontalDistance(player.location, { x: target.x, z: target.z }) <= ARENA_MATERIALIZE_DISTANCE)) {
      continue;
    }
    queueObsidilithArenaPlacement(dimension, target, (success) => {
      if (!success) return;
      recordMaterializedArena(target);
      playSound(dimension, "bomd.obsidilith.teleport", { x: target.x, y: target.y + TOP_OFFSET_Y, z: target.z }, 2.5, 0.7);
    });
  }
}

function planNaturalArenas() {
  const dimension = world.getDimension("the_end");
  const players = dimension.getPlayers().filter(isArenaPlayer);
  if (players.length === 0) return;
  const planned = readLocations(OBSIDILITH_PLANNED_PROPERTY);
  const known = readLocations(OBSIDILITH_KNOWN_PROPERTY);
  let changed = false;
  for (const player of players) {
    if (horizontalDistance(player.location, { x: 0, z: 0 }) < OUTER_END_MIN_RADIUS) continue;
    for (const candidate of planCandidates(player.location)) {
      if (planned.some((entry) => sameLocation(entry, candidate)) || known.some((entry) => sameLocation(entry, candidate))) continue;
      planned.push(candidate);
      changed = true;
    }
  }
  if (changed) writeLocations(OBSIDILITH_PLANNED_PROPERTY, planned);
}

function consumeSummonItem(player, itemTypeId) {
  if (isCreative(player)) return true;
  return consumeSelectedItem(player, itemTypeId);
}

function selectedItemTypeId(player) {
  const inventory = attempt(
    () => player.getComponent("minecraft:inventory")?.container,
    "read Obsidilith summoning inventory"
  );
  if (!inventory) return undefined;
  return attempt(
    () => inventory.getItem(player.selectedSlotIndex)?.typeId,
    "read Obsidilith summoning item"
  );
}

function ritualKey(dimension, location) {
  return `${dimension.id}:${location.x},${location.y},${location.z}`;
}

function clearSummonFrameOnce(dimension, location) {
  const frameLocation = {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z)
  };
  const current = attempt(
    () => dimension.getBlock(frameLocation),
    "read Obsidilith summon frame for cleanup"
  );
  if (!current || current.typeId !== OBSIDILITH_END_FRAME_BLOCK) return true;

  const cleared = attempt(() => {
    dimension.setBlockType(frameLocation, "minecraft:air");
    return true;
  }, "remove Obsidilith summon frame with Dimension.setBlockType") === true;
  if (!cleared) return false;

  const verification = attempt(
    () => dimension.getBlock(frameLocation),
    "verify Obsidilith summon frame cleanup"
  );
  return !verification || verification.typeId !== OBSIDILITH_END_FRAME_BLOCK;
}

function removeSummonFrame(dimension, location) {
  if (clearSummonFrameOnce(dimension, location)) return;
  for (const delay of [1, 2, 5, 10, 20]) {
    system.runTimeout(() => {
      clearSummonFrameOnce(dimension, location);
    }, delay);
  }
}

function startRitual(dimension, location) {
  const key = ritualKey(dimension, location);
  if (activeRituals.has(key)) return;
  const ritual = { tick: 0, interval: 0 };
  ritual.interval = system.runInterval(() => {
    ritual.tick += 1;
    const center = { x: location.x + 0.5, y: location.y + 1, z: location.z + 0.5 };
    const particleCount = ritual.tick >= 80 ? 3 : 1;
    for (let index = 0; index < particleCount; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 2;
      spawnParticle(dimension, OBSIDILITH_PILLAR_RUNE_PARTICLE, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + 0.5 + Math.random() * 2.5,
        z: center.z + Math.sin(angle) * radius
      });
    }
    if (ritual.tick % 5 === 0) {
      const angle = ritual.tick * 0.31;
      spawnParticle(dimension, OBSIDILITH_PILLAR_SPAWN_PARTICLE, {
        x: center.x + Math.cos(angle) * 1.6,
        y: center.y + 0.05,
        z: center.z + Math.sin(angle) * 1.6
      });
    }
    if (ritual.tick % 20 === 0 && ritual.tick < 100) {
      playSound(dimension, "bomd.obsidilith.prepare_attack", center, 1.1, 0.6 + ritual.tick / 180);
    }
    if (ritual.tick < 100) return;

    system.clearRun(ritual.interval);
    activeRituals.delete(key);
    // Java removes the summoning block at the exact spawn milestone. Use the
    // dimension-level setter and retry if Bedrock briefly invalidates the Block handle.
    removeSummonFrame(dimension, location);
    const existing = dimension.getEntities({ type: OBSIDILITH_TYPE, location: center, maxDistance: 48 });
    if (existing.length > 0) return;
    spawnBurst(dimension, center, 54, 3.5, OBSIDILITH_RIFT_INDICATOR_PARTICLE);
    playSound(dimension, "bomd.obsidilith.teleport", center, 2.5, 0.8);
    const boss = attempt(
      () => dimension.spawnEntity(OBSIDILITH_TYPE, { x: center.x, y: location.y, z: center.z }),
      "spawn Obsidilith"
    );
    if (isEntityUsable(boss)) {
      boss.nameTag = "Obsidilith";
      removeSummonFrame(dimension, location);
    }
  }, 1);
  activeRituals.set(key, ritual);
}

function activateFrame(event) {
  const block = event.block;
  const player = event.player;
  if (!isEntityUsable(player) || player.typeId !== "minecraft:player") return;
  const location = { ...block.location };
  if (block.permutation.getState("bomd:eye") === true) {
    // A filled frame can safely resume its ritual after a reload/interrupted script tick.
    startRitual(block.dimension, location);
    return;
  }
  const heldTypeId = selectedItemTypeId(player);
  if (heldTypeId !== "minecraft:ender_eye" && heldTypeId !== "minecraft:ender_pearl") return;
  const existing = block.dimension.getEntities({
    type: OBSIDILITH_TYPE,
    location: { x: location.x + 0.5, y: location.y, z: location.z + 0.5 },
    maxDistance: 48
  });
  if (existing.length > 0) {
    player.onScreenDisplay.setActionBar("§5The monolith is already awake");
    return;
  }
  if (!consumeSummonItem(player, heldTypeId)) return;
  block.setPermutation(block.permutation.withState("bomd:eye", true));
  playSound(block.dimension, "block.end_portal_frame.fill", block.location, 1, 1);
  spawnBurst(block.dimension, { x: block.location.x + 0.5, y: block.location.y + 1, z: block.location.z + 0.5 }, 24, 1.3, OBSIDILITH_RIFT_INDICATOR_PARTICLE);
  startRitual(block.dimension, location);
}

function locateCommand(event) {
  if (event.id !== "bomd:locate") return;
  const requested = event.message.trim().toLowerCase();
  if (requested !== "obsidilith") return;
  const player = event.sourceEntity;
  if (!isEntityUsable(player) || player.typeId !== "minecraft:player") return;
  if (player.dimension.id !== "minecraft:the_end") {
    player.sendMessage("§c[BOMD] Obsidilith can only be located from the End.");
    return;
  }
  const target = nearestObsidilithArena(player.location);
  if (!target) return;
  const safeY = Math.floor(target.y) + 2;
  const placementTarget = {
    x: Math.floor(target.x),
    y: Math.floor(target.y) - TOP_OFFSET_Y,
    z: Math.floor(target.z)
  };
  queueObsidilithArenaPlacement(player.dimension, placementTarget, (success) => {
    if (!isEntityUsable(player)) return;
    if (success) {
      recordMaterializedArena(placementTarget);
      player.sendMessage("§5[BOMD] §aObsidilith arena materialized successfully.");
    } else {
      player.sendMessage("§5[BOMD] §cObsidilith arena placement failed. Use /function bomd/obsidilith/build_arena while standing where you want the arena base.");
    }
  });
  player.sendMessage(
    `§5[BOMD] §fObsidilith arena: §dX ${Math.floor(target.x)}, Y ${safeY}, Z ${Math.floor(target.z)}§f ` +
    `(summoning frame Y ${Math.floor(target.y)}). §7Generation has been queued immediately.`
  );
  player.onScreenDisplay.setActionBar(`§dObsidilith §7— §f${Math.round(horizontalDistance(player.location, target))} blocks`);
  playSound(player.dimension, "random.bow", player.location, 0.8, 0.5);
}

function spawnStructureCommand(event) {
  const direct = event.id === "bomd:spawn_obsidilith_arena";
  const generic = event.id === "bomd:spawn_structure" && event.message.trim().toLowerCase() === "obsidilith";
  if (!direct && !generic) return;
  const player = event.sourceEntity;
  if (!isArenaPlayer(player)) return;

  const target = {
    x: Math.floor(player.location.x),
    y: Math.floor(player.location.y),
    z: Math.floor(player.location.z)
  };
  player.sendMessage(
    `§5[BOMD] §fGenerating the Obsidilith arena centered at X ${target.x}, Z ${target.z}; base Y ${target.y}. ` +
    `§7The summoning frame will be at Y ${target.y + TOP_OFFSET_Y}.`
  );
  queueObsidilithArenaPlacement(player.dimension, target, (success) => {
    if (!isEntityUsable(player)) return;
    if (success) {
      recordMaterializedArena(target);
      player.sendMessage("§5[BOMD] §aObsidilith arena generated.");
      playSound(player.dimension, "bomd.obsidilith.teleport", { x: target.x, y: target.y + TOP_OFFSET_Y, z: target.z }, 2.5, 0.7);
    } else {
      player.sendMessage("§5[BOMD] §cScript placement failed. Use /function bomd/obsidilith/build_arena as the vanilla structure-command fallback.");
    }
  });
}

function directionName(from, to) {
  const angle = (Math.atan2(to.z - from.z, to.x - from.x) * 180) / Math.PI;
  const directions = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  return directions[Math.round(((angle + 360) % 360) / 45) % directions.length];
}

function naturalDiscoveryHints() {
  const dimension = world.getDimension("the_end");
  for (const player of dimension.getPlayers().filter(isArenaPlayer)) {
    const target = nearestObsidilithArena(player.location);
    if (!target) continue;
    const range = Math.round(horizontalDistance(player.location, target));
    if (range > DISCOVERY_RANGE) continue;
    const direction = directionName(player.location, target);
    const key = `${player.id}:${Math.floor(target.x)},${Math.floor(target.z)}`;
    player.onScreenDisplay.setActionBar({
      translate: "message.bomd.obsidilith_resonance.actionbar",
      with: [direction, String(range)]
    });
    if (discoveryNotices.has(key)) continue;
    discoveryNotices.add(key);
    player.sendMessage({
      translate: "message.bomd.obsidilith_resonance",
      with: [direction]
    });
    playSound(dimension, "bomd.obsidilith.teleport", player.location, 0.8, 0.55);
  }
}

export function recordObsidilithDefeated(location) {
  const defeatedLocations = readLocations(OBSIDILITH_DEFEATED_PROPERTY);
  if (!defeatedLocations.some((entry) => horizontalDistance(entry, location) < 48)) {
    writeLocations(OBSIDILITH_DEFEATED_PROPERTY, [...defeatedLocations, { x: location.x, z: location.z }]);
  }
}

export function registerObsidilithProgression(blockComponentRegistry) {
  if (registered) return;
  registered = true;
  blockComponentRegistry.registerCustomComponent("bomd:obsidilith_end_frame", { onPlayerInteract: activateFrame });
  world.afterEvents.entitySpawn.subscribe((event) => {
    if (event.entity.typeId !== OBSIDILITH_TYPE || !isEntityUsable(event.entity)) return;
    const spawnLocation = {
      x: Math.floor(event.entity.location.x),
      y: Math.floor(event.entity.location.y),
      z: Math.floor(event.entity.location.z)
    };
    removeSummonFrame(event.entity.dimension, spawnLocation);
  });
  // Script events are exposed through system in the stable Script API.
  system.afterEvents.scriptEventReceive.subscribe(locateCommand);
  system.afterEvents.scriptEventReceive.subscribe(spawnStructureCommand);
  system.runTimeout(planNaturalArenas, 1);
  system.runTimeout(materializePlannedArenas, 2);
  system.runInterval(planNaturalArenas, 100);
  system.runInterval(materializePlannedArenas, 10);
  system.runInterval(naturalDiscoveryHints, 100);
}
