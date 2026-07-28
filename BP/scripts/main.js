// @ts-check

import { system } from "@minecraft/server";
import { registerBossDeathEvents } from "./bosses/death_events.js";
import { startLichPhantomManager } from "./bosses/lich_phantoms.js";
import { startNightLichManager } from "./bosses/night_lich.js";
import { startNetherGauntletManager } from "./bosses/nether_gauntlet.js";
import { registerCombatDebug } from "./core/combat_debug.js";
import { startExplosionHistory } from "./core/explosion_history.js";
import { startProjectileHistory } from "./core/projectile_history.js";
import { startHybridTimelineBridge } from "./core/hybrid_timeline.js";
import { runSafely } from "./core/safe.js";
import { registerNightLichProgression } from "./progression/register.js";
import { registerProjectileEvents } from "./projectiles/projectile_events.js";

function initializeSubsystem(label, initializer) {
  const succeeded = runSafely(initializer, `initialize ${label}`);
  console.warn(`[BOMD] ${label}: ${succeeded ? "ready" : "failed"}`);
  return succeeded;
}

initializeSubsystem("progression", registerNightLichProgression);
initializeSubsystem("projectile events", registerProjectileEvents);
initializeSubsystem("combat debug", registerCombatDebug);
initializeSubsystem("projectile history", startProjectileHistory);
initializeSubsystem("explosion history", startExplosionHistory);
initializeSubsystem("hybrid behavior timelines", startHybridTimelineBridge);

initializeSubsystem("boss death events", registerBossDeathEvents);

system.run(() => {
  initializeSubsystem("Lich phantom manager", startLichPhantomManager);
  initializeSubsystem("Night Lich manager", startNightLichManager);
  initializeSubsystem("Nether Gauntlet manager", startNetherGauntletManager);
  console.warn("[BOMD] Public Beta 1.5.4 Soul Star locator stability runtime bootstrap completed.");
});
