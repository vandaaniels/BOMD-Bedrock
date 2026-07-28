// @ts-check

import {
  EquipmentSlot,
  GameMode,
  ItemStack,
  system,
  world
} from "@minecraft/server";
import {
  ALTAR_BLOCK,
  ALTAR_LIT_STATE,
  ALTAR_OFFSETS,
  ANCHOR_TYPE,
  BOSS_TYPE,
  FROST_PARTICLE,
  HOME_X_PROPERTY,
  HOME_Y_PROPERTY,
  HOME_Z_PROPERTY,
  PHASE_RUNES_PARTICLE,
  SOUL_FLAME_PARTICLE,
  SOUL_STAR_ITEM,
  TOWER_ACTIVE_PROPERTY,
  TOWER_DEFEATED_PROPERTY,
  TOWER_GUARD_MASK_PROPERTY,
  TOWER_GUARD_TAG,
  TOWER_INITIALIZED_PROPERTY,
  TOWER_LOOT_MASK_PROPERTY,
  TOWER_ROTATION_PROPERTY,
  TOWER_PENDING_EXPERIENCE_PROPERTY
} from "../core/config.js";
import { translate } from "../core/i18n.js";
import { attempt, isEntityUsable, schedule } from "../core/safe.js";
import { fitVerticalSpan, isLocationWithinWorld, verticalSpanFits } from "../core/world_bounds.js";
import { distance } from "../core/vector.js";
import {
  playSound,
  spawnBurst,
  spawnParticle,
  spawnRing
} from "../visuals/frost.js";
import { cleanupEncounterEntities } from "../bosses/encounter_cleanup.js";
import { consumeSelectedItem } from "./inventory.js";
import {
  registerStructureLocation,
  setRegisteredStructureDefeated
} from "./structure_locator.js";
import {
  markLocatorTowerAvailable,
  markLocatorTowerDefeated
} from "./night_lich_tower_locator.js";

const CHEST_OFFSETS = Object.freeze([
  Object.freeze({ x: 0, y: -21, z: 0 }),
  Object.freeze({ x: 0, y: -13, z: 0 }),
  Object.freeze({ x: 0, y: 14, z: 0 }),
  Object.freeze({ x: -5, y: 25, z: -2 }),
  Object.freeze({ x: 3, y: 36, z: -6 })
]);

const GUARD_OFFSETS = Object.freeze([
  Object.freeze({ x: 0, y: -20, z: 0 }),
  Object.freeze({ x: 0, y: 1, z: 0 })
]);

const COMPLETE_CHEST_MASK = (1 << CHEST_OFFSETS.length) - 1;
const COMPLETE_GUARD_MASK = (1 << GUARD_OFFSETS.length) - 1;
// The converted structure begins 23 blocks below the ritual center and ends
// 55 blocks above it (79 blocks total).
const TOWER_MIN_Y_OFFSET = -23;
const TOWER_MAX_Y_OFFSET = 55;
const INVALID_BOUNDS_TAG = "bomd_invalid_tower_bounds";
const TOWER_PLACEHOLDER_TYPES = new Set([
  "minecraft:info_update",
  "minecraft:info_update2",
  "minecraft:unknown"
]);
const scannedPlaceholderChunks = new Set();
let registered = false;
let scanStarted = false;

function towerCenter(anchor) {
  return {
    x: Math.floor(anchor.location.x) + 0.5,
    y: Math.floor(anchor.location.y),
    z: Math.floor(anchor.location.z) + 0.5
  };
}

function addLocation(center, offset) {
  return {
    x: center.x + offset.x,
    y: center.y + offset.y,
    z: center.z + offset.z
  };
}

function rotateOffset(offset, rotation) {
  const turns = ((rotation % 4) + 4) % 4;
  if (turns === 1) {
    return { x: -offset.z, y: offset.y, z: offset.x };
  }
  if (turns === 2) {
    return { x: -offset.x, y: offset.y, z: -offset.z };
  }
  if (turns === 3) {
    return { x: offset.z, y: offset.y, z: -offset.x };
  }
  return offset;
}

function safeTowerBlock(dimension, location) {
  if (!isLocationWithinWorld(dimension, location)) return undefined;
  return attempt(() => dimension.getBlock(location), "read Lich Tower block");
}

function altarBlocks(anchor) {
  const center = towerCenter(anchor);
  return ALTAR_OFFSETS.map((offset) =>
    safeTowerBlock(anchor.dimension, addLocation(center, offset))
  ).filter(Boolean);
}

function ensureTowerAltars(anchor) {
  const center = towerCenter(anchor);
  let complete = true;
  for (const offset of ALTAR_OFFSETS) {
    const location = addLocation(center, offset);
    let block = safeTowerBlock(anchor.dimension, location);
    if (!block) {
      complete = false;
      continue;
    }
    if (block.typeId !== ALTAR_BLOCK) {
      const repaired = attempt(() => {
        block.setType(ALTAR_BLOCK);
        block = anchor.dimension.getBlock(location);
        if (block?.typeId === ALTAR_BLOCK) {
          block.setPermutation(
            block.permutation.withState(ALTAR_LIT_STATE, false)
          );
          return true;
        }
        return false;
      }, "repair Lich Tower altar marker");
      if (repaired !== true) complete = false;
    }
  }
  return complete;
}

function nearestAnchor(dimension, location, radius = 24) {
  return (
    dimension
      .getEntities({
        type: ANCHOR_TYPE,
        location,
        maxDistance: radius
      })
      .filter(isEntityUsable)
      .sort(
        (left, right) =>
          distance(left.location, location) -
          distance(right.location, location)
      )[0]
  );
}

function blockBelongsToAnchor(anchor, block) {
  const target = block.location;
  return altarBlocks(anchor).some(
    (candidate) =>
      candidate.location.x === target.x &&
      candidate.location.y === target.y &&
      candidate.location.z === target.z
  );
}

function detectTowerRotation(anchor) {
  const stored = anchor.getDynamicProperty(TOWER_ROTATION_PROPERTY);
  if (
    typeof stored === "number" &&
    Number.isInteger(stored) &&
    stored >= 0 &&
    stored <= 3
  ) {
    return stored;
  }

  const center = towerCenter(anchor);
  let bestRotation;
  let bestScore = -1;
  for (let rotation = 0; rotation < 4; rotation += 1) {
    let score = 0;
    for (const offset of CHEST_OFFSETS) {
      const location = addLocation(center, rotateOffset(offset, rotation));
      const block = safeTowerBlock(anchor.dimension, location);
      if (block?.typeId === "minecraft:chest") {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestRotation = rotation;
      bestScore = score;
    }
  }

  if (bestRotation === undefined || bestScore < 4) {
    return undefined;
  }
  anchor.setDynamicProperty(TOWER_ROTATION_PROPERTY, bestRotation);
  return bestRotation;
}

function fillChest(anchor, location) {
  const block = safeTowerBlock(anchor.dimension, location);
  const container = block?.getComponent("minecraft:inventory")?.container;
  if (!container) {
    return false;
  }

  const lootManager = world.getLootTableManager();
  const table = lootManager.getLootTable(
    "bomd/night_lich/lich_tower_chest"
  );
  if (!table) {
    console.warn("[BOMD] Lich Tower chest loot table was not found.");
    return false;
  }

  container.clearAll();
  for (const stack of lootManager.generateLootFromTable(table) ?? []) {
    container.addItem(stack);
  }
  return true;
}

function chestAlreadyPopulated(anchor, location) {
  const container = safeTowerBlock(anchor.dimension, location)
    ?.getComponent("minecraft:inventory")?.container;
  return container
    ? container.emptySlotsCount < container.size
    : undefined;
}

function spawnGuard(anchor, location) {
  const existing = anchor.dimension.getEntities({
    tags: [TOWER_GUARD_TAG],
    location,
    maxDistance: 4
  });
  if (existing.length > 0) {
    return true;
  }

  const guard = attempt(
    () => anchor.dimension.spawnEntity("minecraft:skeleton", location),
    "spawn tower skeleton"
  );
  if (!isEntityUsable(guard)) {
    return false;
  }

  guard.addTag(TOWER_GUARD_TAG);
  const equipment = guard.getComponent("minecraft:equippable");
  equipment?.setEquipment(
    EquipmentSlot.Mainhand,
    new ItemStack("minecraft:stone_sword")
  );
  equipment?.setEquipment(
    EquipmentSlot.Head,
    new ItemStack("minecraft:chainmail_helmet")
  );
  equipment?.setEquipment(
    EquipmentSlot.Chest,
    new ItemStack("minecraft:chainmail_chestplate")
  );
  return true;
}

function initializeTower(anchor) {
  if (!isEntityUsable(anchor)) {
    return false;
  }

  const registeredCenter = towerCenter(anchor);
  registerStructureLocation("night_lich", anchor.dimension, registeredCenter, {
    defeated: anchor.getDynamicProperty(TOWER_DEFEATED_PROPERTY) === true
  });
  const centerY = registeredCenter.y;
  if (!verticalSpanFits(anchor.dimension, centerY, TOWER_MIN_Y_OFFSET, TOWER_MAX_Y_OFFSET)) {
    if (!anchor.hasTag(INVALID_BOUNDS_TAG)) {
      attempt(() => anchor.addTag(INVALID_BOUNDS_TAG), "mark invalid Lich Tower anchor");
      console.warn(`[BOMD] Ignoring Lich Tower anchor at Y ${centerY}: the 79-block structure does not fit inside this dimension.`);
    }
    return false;
  }

  // Structures saved with an older custom-block palette can appear as the
  // brown update/marker block in Bedrock. Replace the four known ritual
  // positions with the registered altar before reading rotation or state.
  if (!ensureTowerAltars(anchor)) {
    anchor.setDynamicProperty(TOWER_INITIALIZED_PROPERTY, false);
    return false;
  }

  if (anchor.getDynamicProperty(TOWER_ACTIVE_PROPERTY) === undefined) {
    anchor.setDynamicProperty(TOWER_ACTIVE_PROPERTY, false);
  }
  if (anchor.getDynamicProperty(TOWER_DEFEATED_PROPERTY) === undefined) {
    anchor.setDynamicProperty(TOWER_DEFEATED_PROPERTY, false);
  }
  if (anchor.getDynamicProperty(TOWER_PENDING_EXPERIENCE_PROPERTY) === undefined) {
    anchor.setDynamicProperty(TOWER_PENDING_EXPERIENCE_PROPERTY, 0);
  }

  const rotation = detectTowerRotation(anchor);
  if (rotation === undefined) {
    anchor.setDynamicProperty(TOWER_INITIALIZED_PROPERTY, false);
    return false;
  }

  const center = towerCenter(anchor);
  const migrating =
    anchor.getDynamicProperty(TOWER_INITIALIZED_PROPERTY) === true &&
    anchor.getDynamicProperty(TOWER_LOOT_MASK_PROPERTY) === undefined;
  let lootMask =
    readMask(anchor, TOWER_LOOT_MASK_PROPERTY) ?? 0;
  for (let index = 0; index < CHEST_OFFSETS.length; index += 1) {
    const bit = 1 << index;
    if ((lootMask & bit) !== 0) {
      continue;
    }
    const location = addLocation(
      center,
      rotateOffset(CHEST_OFFSETS[index], rotation)
    );
    const populated = migrating
      ? attempt(
          () => chestAlreadyPopulated(anchor, location),
          "inspect migrated Lich Tower chest"
        )
      : false;
    if (
      populated === true ||
      attempt(
        () => fillChest(anchor, location),
        "fill Lich Tower chest"
      ) === true
    ) {
      lootMask |= bit;
      anchor.setDynamicProperty(TOWER_LOOT_MASK_PROPERTY, lootMask);
    }
  }

  const defeated =
    anchor.getDynamicProperty(TOWER_DEFEATED_PROPERTY) === true;
  let guardMask = defeated
    ? COMPLETE_GUARD_MASK
    : readMask(anchor, TOWER_GUARD_MASK_PROPERTY) ?? 0;
  if (defeated) {
    anchor.setDynamicProperty(TOWER_GUARD_MASK_PROPERTY, guardMask);
  } else {
    for (let index = 0; index < GUARD_OFFSETS.length; index += 1) {
      const bit = 1 << index;
      if ((guardMask & bit) !== 0) {
        continue;
      }
      const offset = rotateOffset(GUARD_OFFSETS[index], rotation);
      const location = {
        ...addLocation(center, offset),
        y: center.y + offset.y + 1
      };
      if (
        attempt(
          () => spawnGuard(anchor, location),
          "initialize Lich Tower guard"
        ) === true
      ) {
        guardMask |= bit;
        anchor.setDynamicProperty(TOWER_GUARD_MASK_PROPERTY, guardMask);
      }
    }
  }

  const complete =
    lootMask === COMPLETE_CHEST_MASK &&
    guardMask === COMPLETE_GUARD_MASK;
  anchor.setDynamicProperty(TOWER_INITIALIZED_PROPERTY, complete);
  return complete;
}

function readMask(anchor, propertyId) {
  const value = anchor.getDynamicProperty(propertyId);
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function allAltarsLit(anchor) {
  const blocks = altarBlocks(anchor);
  return (
    blocks.length === ALTAR_OFFSETS.length &&
    blocks.every(
      (block) =>
        block.typeId === ALTAR_BLOCK &&
        block.permutation.getState(ALTAR_LIT_STATE) === true
    )
  );
}

function findBossSpawn(anchor, center) {
  for (let attemptIndex = 0; attemptIndex < 200; attemptIndex += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 15 + Math.random() * 15;
    const candidate = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + 4 + Math.random() * 4,
      z: center.z + Math.sin(angle) * radius
    };

    let clear = true;
    for (let y = 0; y < 4; y += 1) {
      const location = {
        x: candidate.x,
        y: candidate.y + y,
        z: candidate.z
      };
      const block = safeTowerBlock(anchor.dimension, location);
      if (!block?.isAir) {
        clear = false;
        break;
      }
    }
    if (clear) {
      return candidate;
    }
  }

  return {
    x: center.x + 5,
    y: center.y + 5,
    z: center.z
  };
}

function summonNightLich(anchor) {
  if (
    !isEntityUsable(anchor) ||
    anchor.getDynamicProperty(TOWER_DEFEATED_PROPERTY) === true
  ) {
    return;
  }

  const center = towerCenter(anchor);
  const existingBoss = anchor.dimension.getEntities({
    type: BOSS_TYPE,
    location: center,
    maxDistance: 64
  })[0];
  if (isEntityUsable(existingBoss)) {
    anchor.setDynamicProperty(TOWER_ACTIVE_PROPERTY, true);
    return;
  }
  if (!allAltarsLit(anchor)) {
    anchor.setDynamicProperty(TOWER_ACTIVE_PROPERTY, false);
    return;
  }

  const boss = attempt(
    () =>
      anchor.dimension.spawnEntity(
        BOSS_TYPE,
        findBossSpawn(anchor, center)
      ),
    "summon Night Lich from altars"
  );
  if (!isEntityUsable(boss)) {
    anchor.setDynamicProperty(TOWER_ACTIVE_PROPERTY, false);
    return;
  }

  for (const block of altarBlocks(anchor)) {
    block.setType("minecraft:air");
    spawnBurst(
      anchor.dimension,
      block.location,
      18,
      0.7,
      SOUL_FLAME_PARTICLE
    );
  }
  boss.setDynamicProperty(HOME_X_PROPERTY, center.x);
  boss.setDynamicProperty(HOME_Y_PROPERTY, center.y + 6);
  boss.setDynamicProperty(HOME_Z_PROPERTY, center.z);
  anchor.setDynamicProperty(TOWER_ACTIVE_PROPERTY, true);
  spawnParticle(
    anchor.dimension,
    PHASE_RUNES_PARTICLE,
    { x: center.x, y: center.y + 4.5, z: center.z }
  );
  spawnRing(anchor.dimension, center, 7, 40);
  playSound(
    anchor.dimension,
    "bomd.night_lich.rage_prepare",
    center,
    1.3,
    0.75
  );
  for (const player of anchor.dimension.getPlayers({
    location: center,
    maxDistance: 64
  })) {
    player.sendMessage(translate("bomd.message.tower.lich_awakes"));
  }
}

function handleAltarInteract(event) {
  const { block, player } = event;
  if (
    !player ||
    block.typeId !== ALTAR_BLOCK ||
    block.permutation.getState(ALTAR_LIT_STATE) === true
  ) {
    return;
  }

  const anchor = nearestAnchor(block.dimension, block.location, 20);
  if (
    !isEntityUsable(anchor) ||
    !blockBelongsToAnchor(anchor, block)
  ) {
    player.sendMessage(translate("bomd.message.tower.unregistered_altar"));
    return;
  }
  if (
    anchor.getDynamicProperty(TOWER_INITIALIZED_PROPERTY) !== true
  ) {
    player.sendMessage(translate("bomd.message.tower.initializing"));
    return;
  }

  const inventory = player.getComponent("minecraft:inventory")?.container;
  const held = inventory?.getItem(player.selectedSlotIndex);
  if (!held || held.typeId !== SOUL_STAR_ITEM) {
    player.onScreenDisplay.setActionBar(translate("bomd.message.tower.requires_soul_star"));
    return;
  }
  if (
    anchor.getDynamicProperty(TOWER_ACTIVE_PROPERTY) === true ||
    anchor.getDynamicProperty(TOWER_DEFEATED_PROPERTY) === true
  ) {
    player.onScreenDisplay.setActionBar(translate("bomd.message.tower.ritual_resolved"));
    return;
  }
  if (!consumeSelectedItem(player, SOUL_STAR_ITEM)) {
    return;
  }

  block.setPermutation(
    block.permutation.withState(ALTAR_LIT_STATE, true)
  );
  spawnBurst(
    block.dimension,
    {
      x: block.location.x + 0.5,
      y: block.location.y + 0.5,
      z: block.location.z + 0.5
    },
    22,
    0.65,
    SOUL_FLAME_PARTICLE
  );
  playSound(
    block.dimension,
    "bomd.night_lich.soul_star",
    block.location,
    0.7,
    0.9 + Math.random() * 0.2
  );

  const filled = altarBlocks(anchor).filter(
    (candidate) =>
      candidate.typeId === ALTAR_BLOCK &&
      candidate.permutation.getState(ALTAR_LIT_STATE) === true
  ).length;
  player.onScreenDisplay.setActionBar(translate("bomd.message.tower.ritual_progress", [filled]));
  if (filled === 4) {
    anchor.setDynamicProperty(TOWER_ACTIVE_PROPERTY, true);
    schedule(
      20,
      () => summonNightLich(anchor),
      "complete Night Lich altar ritual"
    );
  }
}

function discoverAnchorFromAltar(block) {
  if (block.typeId !== ALTAR_BLOCK) {
    return;
  }

  for (const altarOffset of ALTAR_OFFSETS) {
    const center = {
      x: block.location.x - altarOffset.x,
      y: block.location.y,
      z: block.location.z - altarOffset.z
    };
    const completePattern = ALTAR_OFFSETS.every((offset) => {
      const candidate = safeTowerBlock(block.dimension, {
        x: center.x + offset.x,
        y: center.y,
        z: center.z + offset.z
      });
      return candidate?.typeId === ALTAR_BLOCK;
    });
    if (!completePattern) {
      continue;
    }

    const anchorLocation = {
      x: center.x + 0.5,
      y: center.y + 0.5,
      z: center.z + 0.5
    };
    if (
      isEntityUsable(
        nearestAnchor(block.dimension, anchorLocation, 2)
      )
    ) {
      return;
    }
    attempt(
      () => block.dimension.spawnEntity(ANCHOR_TYPE, anchorLocation),
      "register naturally generated Lich Tower"
    );
    return;
  }
}

export function resetTower(anchor) {
  if (!isEntityUsable(anchor)) {
    return false;
  }

  const center = towerCenter(anchor);
  cleanupEncounterEntities(anchor.dimension, center, 96);
  for (const boss of anchor.dimension.getEntities({
    type: BOSS_TYPE,
    location: center,
    maxDistance: 64
  })) {
    attempt(() => boss.remove(), "remove tower boss during reset");
  }
  for (const offset of ALTAR_OFFSETS) {
    const location = addLocation(center, offset);
    const block = safeTowerBlock(anchor.dimension, location);
    if (!block) {
      continue;
    }
    if (block.typeId === ALTAR_BLOCK) {
      block.setPermutation(
        block.permutation.withState(ALTAR_LIT_STATE, false)
      );
    } else {
      block.setType(ALTAR_BLOCK);
    }
  }
  anchor.setDynamicProperty(TOWER_ACTIVE_PROPERTY, false);
  anchor.setDynamicProperty(TOWER_DEFEATED_PROPERTY, false);
  setRegisteredStructureDefeated("night_lich", anchor.dimension, center, false);
  markLocatorTowerAvailable(anchor.dimension, center);
  anchor.setDynamicProperty(TOWER_GUARD_MASK_PROPERTY, 0);
  anchor.setDynamicProperty(TOWER_PENDING_EXPERIENCE_PROPERTY, 0);
  anchor.setDynamicProperty(TOWER_INITIALIZED_PROPERTY, false);
  spawnBurst(anchor.dimension, center, 30, 2, FROST_PARTICLE);
  return true;
}

function pendingExperience(anchor) {
  const value = Number(anchor.getDynamicProperty(TOWER_PENDING_EXPERIENCE_PROPERTY) ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function experienceAnchor(dimension, location) {
  return dimension
    .getEntities({ type: ANCHOR_TYPE, location, maxDistance: 80 })
    .filter(isEntityUsable)
    .sort((left, right) => {
      const leftActive = left.getDynamicProperty(TOWER_ACTIVE_PROPERTY) === true ? 0 : 1;
      const rightActive = right.getDynamicProperty(TOWER_ACTIVE_PROPERTY) === true ? 0 : 1;
      return leftActive - rightActive || distance(left.location, location) - distance(right.location, location);
    })[0];
}

export function queueTowerExperience(dimension, location, amount) {
  const value = Math.max(0, Math.floor(amount));
  if (value <= 0) return true;
  const anchor = experienceAnchor(dimension, location);
  if (!isEntityUsable(anchor)) return false;
  anchor.setDynamicProperty(
    TOWER_PENDING_EXPERIENCE_PROPERTY,
    pendingExperience(anchor) + value
  );
  return true;
}

export function consumeTowerExperience(dimension, location, amount) {
  const value = Math.max(0, Math.floor(amount));
  if (value <= 0) return true;
  const anchor = experienceAnchor(dimension, location);
  if (!isEntityUsable(anchor)) return false;
  anchor.setDynamicProperty(
    TOWER_PENDING_EXPERIENCE_PROPERTY,
    Math.max(0, pendingExperience(anchor) - value)
  );
  return true;
}

function deliverPendingTowerExperience(anchor) {
  // While the death sequence is still active, the pending value is a reserve
  // backing the scheduled pulses. Releasing it early would duplicate the
  // reward: the scan loop could pay all 1,500 XP and the pulses would then pay
  // it again. Only release a remainder after the tower is marked defeated.
  if (anchor.getDynamicProperty(TOWER_DEFEATED_PROPERTY) !== true) return false;
  const amount = pendingExperience(anchor);
  if (amount <= 0) return false;
  const player = anchor.dimension
    .getPlayers({ location: anchor.location, maxDistance: 32 })
    .filter(isEntityUsable)
    .sort((left, right) => distance(left.location, anchor.location) - distance(right.location, anchor.location))[0];
  if (!isEntityUsable(player)) return false;
  const delivered = attempt(() => {
    player.addExperience(amount);
    return true;
  }, "deliver pending Night Lich experience") === true;
  if (!delivered) return false;
  anchor.setDynamicProperty(TOWER_PENDING_EXPERIENCE_PROPERTY, 0);
  spawnBurst(anchor.dimension, { x: anchor.location.x, y: anchor.location.y + 1, z: anchor.location.z }, 12, 0.9, SOUL_FLAME_PARTICLE);
  return true;
}

export function markTowerDefeated(dimension, location) {
  const anchor = dimension
    .getEntities({
      type: ANCHOR_TYPE,
      location,
      maxDistance: 80
    })
    .filter(
      (candidate) =>
        isEntityUsable(candidate) &&
        candidate.getDynamicProperty(TOWER_ACTIVE_PROPERTY) === true
    )
    .sort(
      (left, right) =>
        distance(left.location, location) -
        distance(right.location, location)
    )[0];
  if (!isEntityUsable(anchor)) {
    return;
  }

  anchor.setDynamicProperty(TOWER_ACTIVE_PROPERTY, false);
  anchor.setDynamicProperty(TOWER_DEFEATED_PROPERTY, true);
  setRegisteredStructureDefeated("night_lich", dimension, anchor.location, true);
  markLocatorTowerDefeated(dimension, anchor.location);
  for (const guard of dimension.getEntities({
    tags: [TOWER_GUARD_TAG],
    location: anchor.location,
    maxDistance: 96
  })) {
    attempt(() => guard.remove(), "remove defeated tower guard");
  }
}

function placeholderPatternAt(dimension, center) {
  return ALTAR_OFFSETS.every((offset) => {
    const block = safeTowerBlock(dimension, addLocation(center, offset));
    return (
      block?.typeId === ALTAR_BLOCK ||
      TOWER_PLACEHOLDER_TYPES.has(block?.typeId ?? "")
    );
  });
}

function repairPlaceholderTowerNear(player) {
  if (!isEntityUsable(player)) return false;
  if (isEntityUsable(nearestAnchor(player.dimension, player.location, 48))) {
    return false;
  }
  const base = {
    x: Math.floor(player.location.x),
    y: Math.floor(player.location.y),
    z: Math.floor(player.location.z)
  };
  for (let y = base.y - 8; y <= base.y + 8; y += 1) {
    for (let x = base.x - 12; x <= base.x + 12; x += 1) {
      for (let z = base.z - 12; z <= base.z + 12; z += 1) {
        const block = safeTowerBlock(player.dimension, { x, y, z });
        if (!TOWER_PLACEHOLDER_TYPES.has(block?.typeId ?? "")) continue;
        for (const offset of ALTAR_OFFSETS) {
          const center = {
            x: x - offset.x,
            y,
            z: z - offset.z
          };
          if (!placeholderPatternAt(player.dimension, center)) continue;
          const anchor = attempt(
            () => player.dimension.spawnEntity(ANCHOR_TYPE, {
              x: center.x + 0.5,
              y: center.y + 0.5,
              z: center.z + 0.5
            }),
            "register placeholder Lich Tower"
          );
          if (isEntityUsable(anchor)) {
            ensureTowerAltars(anchor);
            schedule(2, () => initializeTower(anchor), "initialize repaired Lich Tower");
            return true;
          }
        }
      }
    }
  }
  return false;
}

function scanAnchors() {
  for (const dimensionId of ["overworld", "nether", "the_end"]) {
    const dimension = world.getDimension(dimensionId);
    for (const anchor of dimension.getEntities({ type: ANCHOR_TYPE })) {
      if (anchor.hasTag(INVALID_BOUNDS_TAG)) continue;
      deliverPendingTowerExperience(anchor);
      if (
        anchor.getDynamicProperty(TOWER_INITIALIZED_PROPERTY) !== true ||
        anchor.getDynamicProperty(TOWER_LOOT_MASK_PROPERTY) === undefined ||
        anchor.getDynamicProperty(TOWER_GUARD_MASK_PROPERTY) === undefined ||
        anchor.getDynamicProperty(TOWER_ROTATION_PROPERTY) === undefined
      ) {
        initializeTower(anchor);
      }
    }
  }
  // Scan at most one newly entered player chunk per manager pass. This
  // repairs older towers without repeatedly sweeping the same area.
  for (const player of world.getAllPlayers()) {
    const chunkKey = `${player.dimension.id}:${Math.floor(player.location.x / 16)}:${Math.floor(player.location.z / 16)}`;
    if (scannedPlaceholderChunks.has(chunkKey)) continue;
    if (scannedPlaceholderChunks.size >= 2048) scannedPlaceholderChunks.clear();
    scannedPlaceholderChunks.add(chunkKey);
    repairPlaceholderTowerNear(player);
    break;
  }
}

function buildTowerForPlayer(player) {
  if (!isEntityUsable(player) || player.typeId !== "minecraft:player") return false;
  const dimension = player.dimension;
  const centerX = Math.floor(player.location.x);
  const centerZ = Math.floor(player.location.z);
  const desiredCenterY = Math.floor(player.location.y);
  const centerY = fitVerticalSpan(
    dimension,
    desiredCenterY,
    TOWER_MIN_Y_OFFSET,
    TOWER_MAX_Y_OFFSET
  );
  if (centerY === undefined) {
    player.sendMessage(translate("bomd.message.tower.build_failed_bounds"));
    return false;
  }

  for (const anchor of dimension.getEntities({
    type: ANCHOR_TYPE,
    location: player.location,
    maxDistance: 12
  })) {
    attempt(() => anchor.remove(), "remove previous manual Lich Tower anchor");
  }

  const origin = {
    x: centerX - 16,
    y: centerY + TOWER_MIN_Y_OFFSET,
    z: centerZ - 14
  };
  const command = `structure load bomd:night_lich_tower ${origin.x} ${origin.y} ${origin.z}`;
  const result = attempt(() => dimension.runCommand(command), "load bounded Lich Tower structure");
  if (!result || result.successCount < 1) {
    player.sendMessage(translate("bomd.message.tower.build_failed"));
    return false;
  }

  const anchor = attempt(
    () => dimension.spawnEntity(ANCHOR_TYPE, {
      x: centerX + 0.5,
      y: centerY + 0.5,
      z: centerZ + 0.5
    }),
    "spawn bounded Lich Tower anchor"
  );
  if (!isEntityUsable(anchor)) {
    player.sendMessage(translate("bomd.message.tower.build_failed"));
    return false;
  }

  schedule(10, () => initializeTower(anchor), "initialize manually built Lich Tower");
  player.sendMessage(translate("bomd.function.lich.build_tower.1"));
  if (centerY !== desiredCenterY) {
    player.sendMessage(translate("bomd.function.lich.build_tower.adjusted", [centerY]));
  }
  if (player.getGameMode() === GameMode.Creative) {
    player.sendMessage(translate("bomd.function.lich.build_tower.2"));
  }
  return true;
}

export function registerTowerEvents(blockComponentRegistry) {
  if (!registered) {
    registered = true;
    blockComponentRegistry.registerCustomComponent("bomd:lich_altar", {
      onPlayerInteract: handleAltarInteract,
      onTick(event) {
        discoverAnchorFromAltar(event.block);
      }
    });

    world.afterEvents.entitySpawn.subscribe((event) => {
      if (event.entity.typeId === ANCHOR_TYPE) {
        schedule(
          10,
          () => initializeTower(event.entity),
          "initialize spawned Lich Tower"
        );
      }
    });

    system.afterEvents.scriptEventReceive.subscribe((event) => {
      if (event.id === "bomd:build_lich_tower") {
        const source = event.sourceEntity;
        if (isEntityUsable(source) && source.typeId === "minecraft:player") {
          buildTowerForPlayer(source);
        }
        return;
      }
      if (event.id !== "bomd:reset_tower") {
        return;
      }
      const source = event.sourceEntity;
      if (
        !isEntityUsable(source) ||
        source.typeId !== "minecraft:player"
      ) {
        return;
      }
      const player =
        /** @type {import("@minecraft/server").Player} */ (source);
      const anchor = nearestAnchor(
        player.dimension,
        player.location,
        96
      );
      if (resetTower(anchor)) {
        player.sendMessage(translate("bomd.message.tower.reset_success"));
      } else {
        player.sendMessage(translate("bomd.message.tower.reset_missing"));
      }
    });
  }

  if (!scanStarted) {
    scanStarted = true;
    system.runInterval(scanAnchors, 40);
  }
}
