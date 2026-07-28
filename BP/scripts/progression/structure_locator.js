// @ts-check

import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  GameMode,
  system,
  world
} from "@minecraft/server";
import { ANCHOR_TYPE, TOWER_DEFEATED_PROPERTY } from "../core/config.js";
import { translate } from "../core/i18n.js";
import { attempt, isEntityUsable, schedule } from "../core/safe.js";

const REGISTRY_PROPERTY = "bomd:structure_registry_v1";
const MAX_RECORDS = 192;
const NIGHT_LICH = "night_lich";
const NETHER_GAUNTLET = "nether_gauntlet";
const VALID_KINDS = new Set([NIGHT_LICH, NETHER_GAUNTLET]);
const VALID_MODES = new Set(["coords", "tp"]);
let commandsRegistered = false;
let eventsRegistered = false;

function canonicalDimensionId(dimensionOrId) {
  const raw = typeof dimensionOrId === "string" ? dimensionOrId : dimensionOrId.id;
  if (raw === "overworld" || raw === "minecraft:overworld") return "minecraft:overworld";
  if (raw === "nether" || raw === "minecraft:nether") return "minecraft:nether";
  if (raw === "the_end" || raw === "minecraft:the_end") return "minecraft:the_end";
  return raw;
}

function dimensionFromId(id) {
  const canonical = canonicalDimensionId(id);
  if (canonical === "minecraft:overworld") return world.getDimension("overworld");
  if (canonical === "minecraft:nether") return world.getDimension("nether");
  if (canonical === "minecraft:the_end") return world.getDimension("the_end");
  return world.getDimension(canonical.replace("minecraft:", ""));
}

function dimensionLabel(id) {
  const canonical = canonicalDimensionId(id);
  if (canonical === "minecraft:overworld") return "Overworld";
  if (canonical === "minecraft:nether") return "Nether";
  if (canonical === "minecraft:the_end") return "The End";
  return canonical;
}

function normalizeRecord(candidate) {
  if (!candidate || typeof candidate !== "object") return undefined;
  const kind = String(candidate.k ?? "");
  const dimension = canonicalDimensionId(String(candidate.d ?? ""));
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const z = Number(candidate.z);
  if (!VALID_KINDS.has(kind) || !dimension || ![x, y, z].every(Number.isFinite)) {
    return undefined;
  }
  return {
    k: kind,
    d: dimension,
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
    v: candidate.v === true
  };
}

function readRegistry() {
  const raw = attempt(() => world.getDynamicProperty(REGISTRY_PROPERTY), "read BOMD structure registry");
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeRecord).filter(Boolean);
  } catch (error) {
    console.warn(`[BOMD] Structure registry was invalid and has been reset: ${String(error)}`);
    return [];
  }
}

function writeRegistry(records) {
  const compact = records.slice(-MAX_RECORDS);
  return attempt(() => {
    world.setDynamicProperty(REGISTRY_PROPERTY, JSON.stringify(compact));
    return true;
  }, "write BOMD structure registry") === true;
}

function recordDistanceSquared(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Registers a generated structure after its marker/core has entered a loaded chunk.
 * The compact world property allows the location to remain available after unload.
 *
 * @param {"night_lich"|"nether_gauntlet"} kind
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {import("@minecraft/server").Vector3} location
 * @param {{ defeated?: boolean }} [options]
 */
export function registerStructureLocation(kind, dimension, location, options = {}) {
  if (!VALID_KINDS.has(kind)) return false;
  const incoming = normalizeRecord({
    k: kind,
    d: dimension.id,
    x: location.x,
    y: location.y,
    z: location.z,
    v: options.defeated === true
  });
  if (!incoming) return false;

  const records = readRegistry();
  const duplicate = records.find(
    (record) =>
      record.k === incoming.k &&
      record.d === incoming.d &&
      recordDistanceSquared(record, incoming) <= 64
  );
  if (duplicate) {
    if (duplicate.v !== incoming.v) {
      duplicate.v = incoming.v;
      return writeRegistry(records);
    }
    return true;
  }

  records.push(incoming);
  return writeRegistry(records);
}

function refreshLoadedNightLichAnchors() {
  for (const dimensionName of ["overworld", "nether", "the_end"]) {
    const dimension = world.getDimension(dimensionName);
    for (const anchor of dimension.getEntities({ type: ANCHOR_TYPE })) {
      if (!isEntityUsable(anchor)) continue;
      registerStructureLocation(NIGHT_LICH, dimension, anchor.location, {
        defeated: anchor.getDynamicProperty(TOWER_DEFEATED_PROPERTY) === true
      });
    }
  }
}

function projectedHorizontalDistance(player, record) {
  const playerDimension = canonicalDimensionId(player.dimension.id);
  let targetX = record.x;
  let targetZ = record.z;
  if (playerDimension === "minecraft:overworld" && record.d === "minecraft:nether") {
    targetX *= 8;
    targetZ *= 8;
  } else if (playerDimension === "minecraft:nether" && record.d === "minecraft:overworld") {
    targetX /= 8;
    targetZ /= 8;
  }
  const dx = targetX - player.location.x;
  const dz = targetZ - player.location.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Returns the nearest persisted structure record. This can resolve structures
 * whose chunks are currently unloaded because their coordinates are stored on
 * the world after discovery or deterministic Soul Star placement.
 *
 * @param {import("@minecraft/server").Player} player
 * @param {"night_lich"|"nether_gauntlet"} kind
 * @param {{ sameDimensionOnly?: boolean, excludeDefeated?: boolean }} [options]
 */
export function findNearestRegisteredStructure(player, kind, options = {}) {
  refreshLoadedNightLichAnchors();
  const playerDimension = canonicalDimensionId(player.dimension.id);
  const records = readRegistry().filter(
    (record) =>
      record.k === kind &&
      (!options.sameDimensionOnly || record.d === playerDimension) &&
      (!options.excludeDefeated || record.v !== true)
  );
  if (records.length === 0) return undefined;
  records.sort((left, right) => {
    const leftSame = left.d === playerDimension ? 0 : 1;
    const rightSame = right.d === playerDimension ? 0 : 1;
    return leftSame - rightSame || projectedHorizontalDistance(player, left) - projectedHorizontalDistance(player, right);
  });
  return records[0];
}

function nearestRecord(player, kind) {
  return findNearestRegisteredStructure(player, kind);
}

/**
 * Marks the nearest matching persisted structure as defeated or available.
 *
 * @param {"night_lich"|"nether_gauntlet"} kind
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {import("@minecraft/server").Vector3} location
 * @param {boolean} defeated
 */
export function setRegisteredStructureDefeated(kind, dimension, location, defeated) {
  const dimensionId = canonicalDimensionId(dimension.id);
  const records = readRegistry();
  let best;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const record of records) {
    if (record.k !== kind || record.d !== dimensionId) continue;
    const currentDistance = recordDistanceSquared(record, location);
    if (currentDistance <= 128 * 128 && currentDistance < bestDistance) {
      bestDistance = currentDistance;
      best = record;
    }
  }
  if (!best) {
    return registerStructureLocation(kind, dimension, location, { defeated });
  }
  if (best.v === defeated) return true;
  best.v = defeated;
  return writeRegistry(records);
}

function isAir(block) {
  return block?.isAir === true;
}

function findSafeArrival(dimension, record) {
  const center = { x: record.x + 0.5, y: record.y, z: record.z + 0.5 };
  const offsets = record.k === NIGHT_LICH
    ? [
        [20, 0], [-20, 0], [0, 20], [0, -20],
        [24, 16], [-24, 16], [24, -16], [-24, -16]
      ]
    : [
        [0, 14], [14, 0], [0, -14], [-14, 0],
        [10, 10], [-10, 10], [10, -10], [-10, -10], [0, 0]
      ];
  const minY = record.k === NIGHT_LICH ? record.y - 4 : record.y - 8;
  const maxY = record.k === NIGHT_LICH ? record.y + 62 : record.y + 18;

  for (const [offsetX, offsetZ] of offsets) {
    const x = Math.floor(center.x + offsetX);
    const z = Math.floor(center.z + offsetZ);
    for (let y = maxY; y >= minY; y -= 1) {
      const floor = attempt(() => dimension.getBlock({ x, y, z }), "inspect structure locator floor");
      if (!floor || isAir(floor)) continue;
      const feet = attempt(() => dimension.getBlock({ x, y: y + 1, z }), "inspect structure locator feet");
      const head = attempt(() => dimension.getBlock({ x, y: y + 2, z }), "inspect structure locator head");
      if (isAir(feet) && isAir(head)) {
        return { x: x + 0.5, y: y + 1, z: z + 0.5 };
      }
    }
  }
  return undefined;
}

function provisionalArrival(record) {
  if (record.k === NIGHT_LICH) {
    return { x: record.x + 0.5, y: record.y + 62, z: record.z + 0.5 };
  }
  return { x: record.x + 0.5, y: record.y + 18, z: record.z + 0.5 };
}

function foundMessageKey(kind) {
  return kind === NIGHT_LICH
    ? "bomd.locator.found.night_lich"
    : "bomd.locator.found.nether_gauntlet";
}

function teleportedMessageKey(kind) {
  return kind === NIGHT_LICH
    ? "bomd.locator.teleported.night_lich"
    : "bomd.locator.teleported.nether_gauntlet";
}

function missingMessageKey(kind) {
  return kind === NIGHT_LICH
    ? "bomd.locator.missing.night_lich"
    : "bomd.locator.missing.nether_gauntlet";
}

function showCoordinates(player, record) {
  const sameDimension = canonicalDimensionId(player.dimension.id) === record.d;
  const distance = sameDimension
    ? Math.round(projectedHorizontalDistance(player, record))
    : "—";
  player.sendMessage(
    translate(foundMessageKey(record.k), [
      record.x,
      record.y,
      record.z,
      dimensionLabel(record.d),
      distance
    ])
  );
}

function teleportToRecord(player, record) {
  const dimension = dimensionFromId(record.d);
  const center = { x: record.x + 0.5, y: record.y + 1, z: record.z + 0.5 };
  const provisional = provisionalArrival(record);
  const moved = attempt(() => {
    player.teleport(provisional, {
      dimension,
      facingLocation: center,
      keepVelocity: false,
      checkForBlocks: false
    });
    return true;
  }, "teleport player to registered BOMD structure") === true;
  if (!moved) {
    player.sendMessage(translate("bomd.locator.teleport_failed"));
    return;
  }

  player.sendMessage(
    translate(teleportedMessageKey(record.k), [record.x, record.y, record.z, dimensionLabel(record.d)])
  );

  // The provisional teleport loads the destination chunk. A second pass then
  // places the Creative player on a nearby two-block-high air column.
  schedule(12, () => {
    if (!isEntityUsable(player) || player.getGameMode() !== GameMode.Creative) return;
    const safe = findSafeArrival(dimension, record);
    if (!safe) return;
    attempt(
      () => player.teleport(safe, { dimension, facingLocation: center, keepVelocity: false, checkForBlocks: true }),
      "finish safe BOMD structure teleport"
    );
  }, "resolve safe BOMD structure arrival");
}

function executeLocate(player, rawKind, rawMode = "coords") {
  if (!isEntityUsable(player) || player.typeId !== "minecraft:player") return;
  if (player.getGameMode() !== GameMode.Creative) {
    player.sendMessage(translate("bomd.locator.creative_only"));
    return;
  }
  const kind = VALID_KINDS.has(rawKind) ? rawKind : undefined;
  const mode = VALID_MODES.has(rawMode) ? rawMode : "coords";
  if (!kind) {
    player.sendMessage(translate("bomd.locator.usage"));
    return;
  }
  const record = nearestRecord(player, kind);
  if (!record) {
    player.sendMessage(translate(missingMessageKey(kind)));
    return;
  }
  if (mode === "tp") teleportToRecord(player, record);
  else showCoordinates(player, record);
}

function customLocateCommand(origin, structureKind, locateMode) {
  const source = origin.sourceEntity;
  if (!isEntityUsable(source) || source.typeId !== "minecraft:player") {
    return { status: CustomCommandStatus.Failure, message: "This command must be run by a player." };
  }
  const player = /** @type {import("@minecraft/server").Player} */ (source);
  if (player.getGameMode() !== GameMode.Creative) {
    system.run(() => player.sendMessage(translate("bomd.locator.creative_only")));
    return { status: CustomCommandStatus.Failure };
  }
  system.run(() => executeLocate(player, String(structureKind), String(locateMode ?? "coords")));
  return { status: CustomCommandStatus.Success };
}

export function registerStructureLocatorCommands(commandRegistry) {
  if (commandsRegistered) return;
  commandRegistry.registerEnum("bomd:structure_kind", [NIGHT_LICH, NETHER_GAUNTLET]);
  commandRegistry.registerEnum("bomd:locate_mode", ["coords", "tp"]);
  commandRegistry.registerCommand(
    {
      name: "bomd:find_structure",
      description: "Find or teleport to a registered BOMD structure (Creative only).",
      permissionLevel: CommandPermissionLevel.Admin,
      cheatsRequired: true,
      mandatoryParameters: [
        { type: CustomCommandParamType.Enum, name: "bomd:structure_kind" }
      ],
      optionalParameters: [
        { type: CustomCommandParamType.Enum, name: "bomd:locate_mode" }
      ]
    },
    customLocateCommand
  );
  commandsRegistered = true;
}

export function registerStructureLocatorEvents() {
  if (eventsRegistered) return;
  system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "bomd:locate") return;
    const source = event.sourceEntity;
    if (!isEntityUsable(source) || source.typeId !== "minecraft:player") return;
    const player = /** @type {import("@minecraft/server").Player} */ (source);
    const [kind = "", mode = "coords"] = event.message.trim().split(/\s+/);
    executeLocate(player, kind, mode);
  });
  eventsRegistered = true;
}
