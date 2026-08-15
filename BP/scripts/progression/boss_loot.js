// @ts-check

import { ItemStack, world } from "@minecraft/server";
import {
  ANCIENT_ANIMA_ITEM,
  BOSS_TYPE,
  CRYSTAL_FRUIT_ITEM,
  OBSIDILITH_TYPE,
  OBSIDIAN_HEART_ITEM,
  VOID_BLOSSOM_TYPE,
  VOID_THORN_ITEM
} from "../core/config.js";
import { attempt } from "../core/safe.js";

const TABLE_BY_BOSS = new Map([
  [BOSS_TYPE, "bomd/night_lich/night_lich"],
  [VOID_BLOSSOM_TYPE, "bomd/void_blossom/void_blossom"],
  [OBSIDILITH_TYPE, "bomd/obsidilith/obsidilith"]
]);

function fallbackLoot(typeId) {
  if (typeId === BOSS_TYPE) {
    return [
      new ItemStack(ANCIENT_ANIMA_ITEM, 2),
      new ItemStack("minecraft:bone", 3 + Math.floor(Math.random() * 4)),
      new ItemStack("minecraft:diamond", 5 + Math.floor(Math.random() * 3)),
      ...Array.from({ length: 5 }, () => new ItemStack("minecraft:book", 1))
    ];
  }
  if (typeId === VOID_BLOSSOM_TYPE) {
    return [
      new ItemStack(VOID_THORN_ITEM, 2),
      new ItemStack(CRYSTAL_FRUIT_ITEM, 2 + Math.floor(Math.random() * 2))
    ];
  }
  if (typeId === OBSIDILITH_TYPE) {
    return [
      new ItemStack(OBSIDIAN_HEART_ITEM, 1),
      ...generateEndCityLoot(),
      new ItemStack("minecraft:purpur_block", 64),
      new ItemStack("minecraft:obsidian", 64)
    ];
  }
  return [];
}

function generateEndCityLoot() {
  const manager = world.getLootTableManager();
  for (const path of [
    "chests/end_city_treasure",
    "loot_tables/chests/end_city_treasure.json",
    "minecraft:chests/end_city_treasure"
  ]) {
    const generated = attempt(() => {
      const table = manager.getLootTable(path);
      return table ? manager.generateLootFromTable(table) : undefined;
    }, `generate End City treasure from ${path}`);
    if (generated && generated.length > 0) return generated;
  }
  // This is only reached on Script API versions that cannot expose vanilla
  // loot tables. The data-driven table above still references the native roll.
  return [new ItemStack("minecraft:diamond", 2)];
}

export function generateBossLoot(typeId) {
  const path = TABLE_BY_BOSS.get(typeId);
  if (!path) return [];
  const generated = attempt(() => {
    const manager = world.getLootTableManager();
    const table = manager.getLootTable(path);
    return table ? manager.generateLootFromTable(table) : undefined;
  }, `generate ${typeId} loot`);
  return generated && generated.length > 0
    ? generated
    : fallbackLoot(typeId);
}

export function dropBossLoot(typeId, dimension, location) {
  const stacks = generateBossLoot(typeId);
  for (const stack of stacks) {
    attempt(
      () => dimension.spawnItem(stack, {
        x: location.x,
        y: location.y + 0.6,
        z: location.z
      }),
      `drop ${typeId} loot`
    );
  }
}
