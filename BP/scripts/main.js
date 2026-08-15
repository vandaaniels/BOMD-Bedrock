// @ts-check

import { system, world } from "@minecraft/server";
import { cleanupEncounterEntities } from "./bosses/encounter_cleanup.js";
import {
  forgetNetherGauntlet,
  startNetherGauntletManager
} from "./bosses/nether_gauntlet.js";
import { startNightLichManager } from "./bosses/night_lich.js";
import {
  forgetVoidBlossom,
  startVoidBlossomManager
} from "./bosses/void_blossom.js";
import { forgetObsidilith, startObsidilithManager } from "./bosses/obsidilith.js";
import {
  BOSS_TYPE,
  GAUNTLET_ENERGY_PARTICLE,
  GAUNTLET_IMPACT_PARTICLE,
  GAUNTLET_TYPE,
  GAUNTLET_WAVE_PARTICLE,
  PHASE_RUNES_PARTICLE,
  SOUL_FLAME_PARTICLE,
  OBSIDILITH_TYPE,
  VOID_BLOSSOM_TYPE,
  VOID_PETAL_PARTICLE
} from "./core/config.js";
import { registerBalanceProfileCommands } from "./core/balance.js";
import { isBossCombatPlayer } from "./core/combat_target.js";
import { attempt, runSafely } from "./core/safe.js";
import { distance } from "./core/vector.js";
import { registerProjectileEvents } from "./projectiles/projectile_events.js";
import { registerGauntletSummon } from "./progression/gauntlet_summon.js";
import {
  recordGauntletArenaDefeated,
  registerGauntletLocator
} from "./progression/gauntlet_locator.js";
import { placeGauntletDeathReward } from "./progression/gauntlet_rewards.js";
import { dropBossLoot, generateBossLoot } from "./progression/boss_loot.js";
import { registerNightLichProgression } from "./progression/register.js";
import { markTowerDefeated } from "./progression/tower.js";
import { recordVoidCavernDefeated } from "./progression/void_cavern.js";
import { recordObsidilithDefeated } from "./progression/obsidilith.js";
import { playSound, spawnBurst, spawnParticle } from "./visuals/frost.js";

registerNightLichProgression();
registerProjectileEvents();
registerGauntletSummon();
registerGauntletLocator();
registerBalanceProfileCommands();

function placeObsidilithDeathReward(dimension, location) {
  const center = {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z)
  };
  attempt(() => dimension.createExplosion(location, 2, {
    breaksBlocks: true,
    causesFire: false
  }), "create Obsidilith death explosion");
  const pillarOffsets = [];
  for (let x = -2; x <= 2; x += 1) {
    for (let z = -2; z <= 2; z += 1) {
      if (x * x + z * z <= 5) pillarOffsets.push({ x, z });
    }
  }
  for (let height = 0; height <= 15; height += 1) {
    system.runTimeout(() => {
      for (const offset of pillarOffsets) {
        attempt(
          () => dimension.getBlock({
            x: center.x + offset.x,
            y: center.y + height,
            z: center.z + offset.z
          })?.setType("minecraft:obsidian"),
          "build Obsidilith death pillar layer"
        );
      }
      playSound(dimension, "dig.stone", {
        x: center.x + 0.5,
        y: center.y + height,
        z: center.z + 0.5
      }, 0.8, 0.72 + height * 0.018);
      spawnBurst(dimension, {
        x: center.x + 0.5,
        y: center.y + height + 0.5,
        z: center.z + 0.5
      }, 20, 2.5, SOUL_FLAME_PARTICLE);
    }, height * 5);
  }

  for (let tick = 0; tick < 20; tick += 1) {
    system.runTimeout(() => {
      const experienceLocation = {
        x: center.x + 0.5 + (Math.random() - 0.5) * 4,
        y: center.y + 15.5,
        z: center.z + 0.5 + (Math.random() - 0.5) * 4
      };
      spawnBurst(dimension, experienceLocation, 3, 0.35, SOUL_FLAME_PARTICLE);
      const receiver = dimension.getPlayers({
        location: experienceLocation,
        maxDistance: 64
      }).filter(isBossCombatPlayer).sort(
        (left, right) => distance(left.location, experienceLocation) - distance(right.location, experienceLocation)
      )[0];
      if (receiver) attempt(() => receiver.addExperience(50), "award gradual Obsidilith experience");
    }, 75 + tick);
  }

  system.runTimeout(() => {
    const rewardLocation = {
      x: center.x,
      y: center.y + 16,
      z: center.z
    };
    const block = attempt(
      () => dimension.getBlock(rewardLocation),
      "read Obsidilith reward position"
    );
    const placed = attempt(() => {
      block?.setType("minecraft:undyed_shulker_box");
      return block?.typeId === "minecraft:undyed_shulker_box";
    }, "place Obsidilith reward shulker") === true;
    const container = placed
      ? attempt(
          () => block?.getComponent("minecraft:inventory")?.container,
          "open Obsidilith reward shulker"
        )
      : undefined;
    const stacks = generateBossLoot(OBSIDILITH_TYPE);
    for (const stack of stacks) {
      if (container) {
        attempt(() => container.addItem(stack), "fill Obsidilith reward shulker");
      } else {
        attempt(
          () => dimension.spawnItem(stack, {
            x: rewardLocation.x + 0.5,
            y: rewardLocation.y + 1,
            z: rewardLocation.z + 0.5
          }),
          "drop fallback Obsidilith reward"
        );
      }
    }
  }, 75);
}


function finalizeGauntletDeathEffects(dimension, location) {
  attempt(() => dimension.createExplosion(location, 4, {
    breaksBlocks: world.gameRules.mobGriefing,
    causesFire: false
  }), "create Nether Gauntlet death explosion");

  // Java awards 1000 experience in 20 batches. Bedrock cannot spawn an XP orb
  // with a chosen value, so transfer each 50-XP batch to the nearest active
  // encounter player at a slightly scattered position, matching the temporal
  // distribution without duplicating the entity JSON reward.
  for (let tick = 0; tick < 20; tick += 1) {
    system.runTimeout(() => {
      const experienceLocation = {
        x: location.x + (Math.random() - 0.5) * 4,
        y: location.y + 1 + Math.random() * 1.5,
        z: location.z + (Math.random() - 0.5) * 4
      };
      spawnBurst(dimension, experienceLocation, 2, 0.28, GAUNTLET_ENERGY_PARTICLE);
      const receiver = dimension.getPlayers({
        location: experienceLocation,
        maxDistance: 64
      }).filter(isBossCombatPlayer).sort(
        (left, right) => distance(left.location, experienceLocation) - distance(right.location, experienceLocation)
      )[0];
      if (receiver) {
        attempt(() => receiver.addExperience(50), "award gradual Nether Gauntlet experience");
      }
    }, tick);
  }
}

world.afterEvents.entityDie.subscribe((event) => {
  if (event.deadEntity.typeId === VOID_BLOSSOM_TYPE) {
    const location = { ...event.deadEntity.location };
    const dimension = event.deadEntity.dimension;
    forgetVoidBlossom(event.deadEntity.id);
    dropBossLoot(VOID_BLOSSOM_TYPE, dimension, location);
    recordVoidCavernDefeated(dimension, location);
    spawnBurst(dimension, location, 64, 4.5, VOID_PETAL_PARTICLE);
    playSound(dimension, "bomd.void_blossom.fall", location, 2.2, 0.9);
    return;
  }
  if (event.deadEntity.typeId === GAUNTLET_TYPE) {
    const location = { ...event.deadEntity.location };
    const dimension = event.deadEntity.dimension;
    forgetNetherGauntlet(event.deadEntity.id);
    recordGauntletArenaDefeated(location);
    finalizeGauntletDeathEffects(dimension, location);
    spawnBurst(
      dimension,
      location,
      72,
      3.4,
      GAUNTLET_IMPACT_PARTICLE
    );
    spawnBurst(
      dimension,
      location,
      48,
      5,
      GAUNTLET_WAVE_PARTICLE
    );
    system.run(() =>
      placeGauntletDeathReward(
        dimension,
        location
      )
    );
    return;
  }

  if (event.deadEntity.typeId === OBSIDILITH_TYPE) {
    const location = { ...event.deadEntity.location };
    const dimension = event.deadEntity.dimension;
    forgetObsidilith(event.deadEntity.id);
    recordObsidilithDefeated(location);
    spawnBurst(dimension, location, 80, 4.5, SOUL_FLAME_PARTICLE);
    playSound(dimension, "bomd.obsidilith.burst", location, 2.4, 0.72);
    system.run(() => placeObsidilithDeathReward(dimension, location));
    return;
  }

  if (event.deadEntity.typeId !== BOSS_TYPE) {
    return;
  }

  dropBossLoot(BOSS_TYPE, event.deadEntity.dimension, event.deadEntity.location);

  cleanupEncounterEntities(
    event.deadEntity.dimension,
    event.deadEntity.location,
    100
  );
  markTowerDefeated(
    event.deadEntity.dimension,
    event.deadEntity.location
  );
  spawnBurst(
    event.deadEntity.dimension,
    event.deadEntity.location,
    64,
    3.4,
    SOUL_FLAME_PARTICLE
  );
  spawnParticle(
    event.deadEntity.dimension,
    PHASE_RUNES_PARTICLE,
    {
      x: event.deadEntity.location.x,
      y: event.deadEntity.location.y + 3,
      z: event.deadEntity.location.z
    }
  );
  playSound(
    event.deadEntity.dimension,
    "bomd.night_lich.soul_star",
    event.deadEntity.location,
    1.2,
    0.72
  );
});

system.run(() => {
  runSafely(startNightLichManager, "start Night Lich manager");
  runSafely(startNetherGauntletManager, "start Nether Gauntlet manager");
  runSafely(startVoidBlossomManager, "start Void Blossom manager");
  runSafely(startObsidilithManager, "start Obsidilith manager");
});
