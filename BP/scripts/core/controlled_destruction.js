// @ts-check

import { world } from "@minecraft/server";
import { isLocationLoaded } from "./world_bounds.js";

const ABSOLUTELY_PROTECTED = new Set([
  "minecraft:bedrock",
  "minecraft:barrier",
  "minecraft:structure_block",
  "minecraft:structure_void",
  "minecraft:jigsaw",
  "minecraft:end_portal",
  "minecraft:end_portal_frame",
  "minecraft:nether_portal",
  "minecraft:command_block",
  "minecraft:chain_command_block",
  "minecraft:repeating_command_block",
  "minecraft:ancient_debris",
  "minecraft:obsidian",
  "minecraft:crying_obsidian",
  "minecraft:respawn_anchor",
  "minecraft:reinforced_deepslate",
  "bomd:gauntlet_blackstone",
  "bomd:sealed_blackstone",
  "bomd:chiseled_stone_altar",
  "bomd:levitation_block"
]);

const SOFT_NETHER_BLOCKS = new Set([
  "minecraft:netherrack",
  "minecraft:blackstone",
  "minecraft:gilded_blackstone",
  "minecraft:basalt",
  "minecraft:smooth_basalt",
  "minecraft:magma",
  "minecraft:soul_sand",
  "minecraft:soul_soil",
  "minecraft:nether_brick",
  "minecraft:nether_bricks",
  "minecraft:red_nether_brick",
  "minecraft:red_nether_bricks",
  "minecraft:gravel"
]);

const GENERAL_BREAKABLE = new Set([
  ...SOFT_NETHER_BLOCKS,
  "minecraft:stone",
  "minecraft:cobblestone",
  "minecraft:deepslate",
  "minecraft:cobbled_deepslate",
  "minecraft:dirt",
  "minecraft:grass_block",
  "minecraft:sand",
  "minecraft:red_sand",
  "minecraft:clay",
  "minecraft:calcite",
  "minecraft:tuff",
  "minecraft:dripstone_block",
  "minecraft:glass",
  "minecraft:glass_pane",
  "minecraft:glowstone",
  "minecraft:shroomlight"
]);

function hasInventory(block) {
  try {
    return block.getComponent("minecraft:inventory") !== undefined;
  } catch {
    return true;
  }
}

export function canBossDestroyBlock(block, mode = "explosion") {
  if (!block || !block.isValid || block.isAir || block.isLiquid) return false;
  const id = block.typeId;
  if (ABSOLUTELY_PROTECTED.has(id) || hasInventory(block)) return false;
  if (!world.gameRules.mobGriefing) return false;
  if (mode === "laser") return SOFT_NETHER_BLOCKS.has(id) || GENERAL_BREAKABLE.has(id);
  return GENERAL_BREAKABLE.has(id) || id.endsWith("_leaves") || id.endsWith("_planks") || id.endsWith("_log") || id.endsWith("_wood");
}

export function destroyBossBlock(dimension, location, mode = "explosion") {
  if (!isLocationLoaded(dimension, location)) return false;
  let block;
  try {
    block = dimension.getBlock(location);
  } catch {
    return false;
  }
  if (!canBossDestroyBlock(block, mode)) return false;
  const center = {
    x: block.location.x + 0.5,
    y: block.location.y + 0.5,
    z: block.location.z + 0.5
  };
  try {
    dimension.spawnParticle("bomd:gauntlet_blackstone_debris", center);
    dimension.spawnParticle("bomd:gauntlet_smoke", center);
  } catch {
    // The block can still be removed if a visual emitter fails.
  }
  try {
    block.setType("minecraft:air");
    return true;
  } catch {
    return false;
  }
}

export function destroyBossBlocksInBox(dimension, minimum, maximum, mode = "explosion", maxBlocks = 48) {
  let destroyed = 0;
  for (let x = Math.floor(minimum.x); x <= Math.floor(maximum.x) && destroyed < maxBlocks; x += 1) {
    for (let y = Math.floor(minimum.y); y <= Math.floor(maximum.y) && destroyed < maxBlocks; y += 1) {
      for (let z = Math.floor(minimum.z); z <= Math.floor(maximum.z) && destroyed < maxBlocks; z += 1) {
        if (destroyBossBlock(dimension, { x, y, z }, mode)) destroyed += 1;
      }
    }
  }
  return destroyed;
}

function coordinateNoise(x, y, z) {
  let value = Math.imul(x | 0, 73428767) ^ Math.imul(y | 0, 912931) ^ Math.imul(z | 0, 438289);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

export function destroyExplosionTerrain(dimension, center, power, maxBlocks = 96) {
  if (!world.gameRules.mobGriefing || power <= 0) return 0;
  const radius = Math.max(1, Math.min(5, Math.ceil(power)));
  let destroyed = 0;
  for (let x = Math.floor(center.x - radius); x <= Math.floor(center.x + radius) && destroyed < maxBlocks; x += 1) {
    for (let y = Math.floor(center.y - radius); y <= Math.floor(center.y + radius) && destroyed < maxBlocks; y += 1) {
      for (let z = Math.floor(center.z - radius); z <= Math.floor(center.z + radius) && destroyed < maxBlocks; z += 1) {
        const dx = x + 0.5 - center.x;
        const dy = y + 0.5 - center.y;
        const dz = z + 0.5 - center.z;
        const normalizedDistance = Math.hypot(dx, dy, dz) / Math.max(0.001, radius);
        if (normalizedDistance > 1) continue;
        const survivalChance = normalizedDistance * 0.72 + coordinateNoise(x, y, z) * 0.36;
        if (survivalChance > 0.88) continue;
        if (destroyBossBlock(dimension, { x, y, z }, "explosion")) destroyed += 1;
      }
    }
  }
  return destroyed;
}
