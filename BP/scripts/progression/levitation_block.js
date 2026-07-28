// @ts-check

import { GameMode, system, world } from "@minecraft/server";
import { translate } from "../core/i18n.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import { isLocationLoaded } from "../core/world_bounds.js";

const BLOCK_TYPE = "bomd:levitation_block";
const RADIUS = 3;
const TABLE_TTL = 240;
const VALIDATION_INTERVAL = 40;
const MANAGER_INTERVAL = 2;
/** @type {Map<string, Map<string, any>>} */
const tablesByDimension = new Map();
const flyingPlayers = new Set();
let managerStarted = false;

function dimensionId(dimension) {
  return dimension.id ?? "unknown";
}

function tableKey(block) {
  const location = block.location;
  return `${location.x}:${location.y}:${location.z}`;
}

function dimensionTables(dimension, create = false) {
  const id = dimensionId(dimension);
  let tables = tablesByDimension.get(id);
  if (!tables && create) {
    tables = new Map();
    tablesByDimension.set(id, tables);
  }
  return tables;
}

function rememberTable(block) {
  dimensionTables(block.dimension, true)?.set(tableKey(block), {
    dimension: block.dimension,
    x: block.location.x,
    y: block.location.y,
    z: block.location.z,
    seenTick: system.currentTick
  });
}

function forgetTable(block) {
  const tables = dimensionTables(block.dimension);
  tables?.delete(tableKey(block));
  if (tables?.size === 0) tablesByDimension.delete(dimensionId(block.dimension));
}

function tableStillExists(table) {
  const location = { x: table.x, y: table.y, z: table.z };
  if (!isLocationLoaded(table.dimension, location)) return true;
  const block = attempt(
    () => table.dimension.getBlock({ x: table.x, y: table.y, z: table.z }),
    "inspect Table of Elevation"
  );
  return block?.typeId === BLOCK_TYPE;
}

function validateTables(now) {
  for (const [dimensionKey, tables] of tablesByDimension) {
    for (const [key, table] of tables) {
      if (now - table.seenTick > TABLE_TTL || !tableStillExists(table)) {
        tables.delete(key);
      }
    }
    if (tables.size === 0) tablesByDimension.delete(dimensionKey);
  }
}

function playerInsideColumn(player, table) {
  return (
    player.location.x >= table.x - RADIUS &&
    player.location.x <= table.x + 1 + RADIUS &&
    player.location.z >= table.z - RADIUS &&
    player.location.z <= table.z + 1 + RADIUS
  );
}

function isAffectedGameMode(player) {
  const mode = attempt(() => player.getGameMode(), "read elevation game mode");
  return mode === GameMode.Survival || mode === GameMode.Adventure;
}

function drawBoundary(player, table) {
  if (system.currentTick % 12 !== 0) return;
  const y = player.location.y + 0.7 + Math.random() * 1.1;
  const minX = table.x - RADIUS;
  const maxX = table.x + 1 + RADIUS;
  const minZ = table.z - RADIUS;
  const maxZ = table.z + 1 + RADIUS;
  const phase = Math.floor(system.currentTick / 12) % 2;
  const locations = phase === 0
    ? [
        { x: minX, y, z: minZ + Math.random() * (maxZ - minZ) },
        { x: maxX, y, z: minZ + Math.random() * (maxZ - minZ) }
      ]
    : [
        { x: minX + Math.random() * (maxX - minX), y, z: minZ },
        { x: minX + Math.random() * (maxX - minX), y, z: maxZ }
      ];
  for (const location of locations) {
    if (!isLocationLoaded(player.dimension, location)) continue;
    attempt(() => player.dimension.spawnParticle("bomd:sparkles", location), "draw Table of Elevation boundary");
  }
}

function applyControlledFlight(player, table) {
  attempt(
    () => player.addEffect("slow_falling", 14, { amplifier: 0, showParticles: false }),
    "apply elevation slow falling"
  );

  const velocity = attempt(() => player.getVelocity(), "read elevation velocity") ?? { x: 0, y: 0, z: 0 };
  let verticalImpulse = 0;
  if (player.isJumping && !player.isSneaking && velocity.y < 0.34) {
    verticalImpulse = 0.12;
  } else if (player.isSneaking && velocity.y > -0.34) {
    verticalImpulse = -0.12;
  } else if (!player.isJumping && !player.isSneaking && velocity.y < -0.06) {
    verticalImpulse = 0.05;
  }
  if (verticalImpulse !== 0) {
    attempt(() => player.applyImpulse({ x: 0, y: verticalImpulse, z: 0 }), "steer Table of Elevation flight");
  }

  drawBoundary(player, table);
  if (!flyingPlayers.has(player.id)) {
    flyingPlayers.add(player.id);
    player.onScreenDisplay.setActionBar(translate("bomd.message.elevation.enter"));
  }
}

function tickElevation() {
  if (tablesByDimension.size === 0 && flyingPlayers.size === 0) return;
  const now = system.currentTick;
  if (now % VALIDATION_INTERVAL === 0) validateTables(now);

  const currentlyAffected = new Set();
  for (const player of world.getAllPlayers()) {
    if (!isEntityUsable(player) || !isAffectedGameMode(player)) continue;
    const tables = tablesByDimension.get(dimensionId(player.dimension));
    if (!tables || tables.size === 0) continue;
    let activeTable;
    for (const table of tables.values()) {
      if (playerInsideColumn(player, table)) {
        activeTable = table;
        break;
      }
    }
    if (!activeTable) continue;
    currentlyAffected.add(player.id);
    applyControlledFlight(player, activeTable);
  }

  for (const playerId of [...flyingPlayers]) {
    if (currentlyAffected.has(playerId)) continue;
    const player = world.getEntity(playerId);
    if (isEntityUsable(player) && player.typeId === "minecraft:player") {
      attempt(() => player.addEffect("slow_falling", 40, { amplifier: 0, showParticles: false }), "protect player leaving Table of Elevation");
      player.onScreenDisplay.setActionBar(translate("bomd.message.elevation.exit"));
    }
    flyingPlayers.delete(playerId);
  }
}

export function registerLevitationBlock(blockComponentRegistry) {
  blockComponentRegistry.registerCustomComponent("bomd:levitation_table", {
    onTick(event) {
      rememberTable(event.block);
      if (system.currentTick % 40 === 0) {
        const center = {
          x: event.block.location.x + 0.5,
          y: event.block.location.y + 1.25,
          z: event.block.location.z + 0.5
        };
        if (isLocationLoaded(event.block.dimension, center)) {
          attempt(() => event.block.dimension.spawnParticle("bomd:phase_runes", center), "animate Table of Elevation");
        }
      }
    },
    onPlayerBreak(event) {
      forgetTable(event.block);
    }
  });

  if (!managerStarted) {
    managerStarted = true;
    system.runInterval(tickElevation, MANAGER_INTERVAL);
  }
}
