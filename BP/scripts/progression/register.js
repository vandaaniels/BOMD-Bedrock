// @ts-check

import { system } from "@minecraft/server";
import { registerSoulKillCounter } from "./kill_counter.js";
import { registerSoulStarLocator } from "./soul_star.js";
import { registerTowerEvents } from "./tower.js";
import { registerTowerSeedComponent } from "./tower_locator.js";
import { registerArtifactComponents } from "./artifacts.js";
import { registerVoidCavernComponents } from "./void_cavern.js";
import { registerObsidilithProgression } from "./obsidilith.js";

let registered = false;

function registerStartupFeature(label, callback) {
  try {
    callback();
  } catch (error) {
    console.error(`[BOMD] Failed to register ${label}: ${error}`);
  }
}

export function registerNightLichProgression() {
  if (registered) {
    return;
  }
  registered = true;

  system.beforeEvents.startup.subscribe((event) => {
    registerStartupFeature("artifact items and blocks", () =>
      registerArtifactComponents(
        event.itemComponentRegistry,
        event.blockComponentRegistry
      )
    );
    registerStartupFeature("Soul Star", () =>
      registerSoulStarLocator(event.itemComponentRegistry)
    );
    registerStartupFeature("Night Lich tower", () =>
      registerTowerEvents(event.blockComponentRegistry)
    );
    registerStartupFeature("Night Lich tower locator", () =>
      registerTowerSeedComponent(event.blockComponentRegistry)
    );
    registerStartupFeature("Void Blossom cavern", () =>
      registerVoidCavernComponents(event.blockComponentRegistry)
    );
    registerStartupFeature("Obsidilith progression", () =>
      registerObsidilithProgression(event.blockComponentRegistry)
    );
  });
  registerSoulKillCounter();
}
