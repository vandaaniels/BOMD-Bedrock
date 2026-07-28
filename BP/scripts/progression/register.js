// @ts-check

import { system } from "@minecraft/server";
import { runSafely } from "../core/safe.js";
import { registerSoulKillCounter } from "./kill_counter.js";
import { registerSoulStarLocator } from "./soul_star.js";
import { registerTowerEvents } from "./tower.js";
import { registerGauntletArenaEvents } from "./gauntlet_arena.js";
import { registerLevitationBlock } from "./levitation_block.js";
import { registerStructureLocatorCommands, registerStructureLocatorEvents } from "./structure_locator.js";

let registered = false;

export function registerNightLichProgression() {
  if (registered) {
    return;
  }
  registered = true;

  system.beforeEvents.startup.subscribe((event) => {
    runSafely(() => registerSoulStarLocator(event.itemComponentRegistry), "register Soul Star item component");
    runSafely(() => registerTowerEvents(event.blockComponentRegistry), "register Night Lich tower components");
    runSafely(() => registerGauntletArenaEvents(event.blockComponentRegistry), "register Gauntlet arena components");
    runSafely(() => registerLevitationBlock(event.blockComponentRegistry), "register levitation block component");
    runSafely(() => registerStructureLocatorCommands(event.customCommandRegistry), "register BOMD structure locator command");
  });
  runSafely(registerSoulKillCounter, "register Soul Star kill counter");
  runSafely(registerStructureLocatorEvents, "register BOMD structure locator events");
}
