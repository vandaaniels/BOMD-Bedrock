// @ts-check

import { GameMode } from "@minecraft/server";
import { attempt } from "../core/safe.js";

export function isCreative(player) {
  return attempt(
    () => player.getGameMode() === GameMode.Creative,
    "read player game mode"
  ) === true;
}

export function consumeSelectedItem(player, expectedTypeId) {
  if (isCreative(player)) {
    return true;
  }

  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) {
    return false;
  }

  const slot = player.selectedSlotIndex;
  const stack = inventory.getItem(slot);
  if (!stack || stack.typeId !== expectedTypeId) {
    return false;
  }

  if (stack.amount <= 1) {
    inventory.setItem(slot, undefined);
  } else {
    stack.amount -= 1;
    inventory.setItem(slot, stack);
  }
  return true;
}
