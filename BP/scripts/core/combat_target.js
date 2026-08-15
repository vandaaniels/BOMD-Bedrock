// @ts-check

import { attempt, isEntityUsable } from "./safe.js";

export function markBossAggressor(_player) {
  // Creative, Adventure, and Spectator players never enter boss target lists.
}

/**
 * Keep boss targeting stable across Script API revisions. Some Bedrock builds
 * expose GameMode enum values with different casing while getGameMode() still
 * returns a string-like enum value. Normalize the runtime value instead of
 * relying on one enum representation.
 */
export function isBossCombatPlayer(player) {
  if (!isEntityUsable(player) || player.typeId !== "minecraft:player") return false;
  const mode = attempt(() => player.getGameMode(), "read boss target game mode");
  if (mode === 0) return true;
  if (mode === undefined || mode === null) return false;
  return String(mode).toLowerCase() === "survival";
}
