// @ts-check

import { system, world } from "@minecraft/server";
import {
  LICH_DEATH_SEQUENCE_TICKS,
  LICH_EXPERIENCE,
  LICH_EXPERIENCE_PULSES,
  PHASE_RUNES_PARTICLE,
  SOUL_FLAME_PARTICLE
} from "../core/config.js";
import { recordCombatEvent } from "../core/combat_debug.js";
import { translate } from "../core/i18n.js";
import { attempt, schedule } from "../core/safe.js";
import { isLocationLoaded } from "../core/world_bounds.js";
import { createGauntletDeathReward } from "../progression/gauntlet_rewards.js";
import { consumeTowerExperience, markTowerDefeated, queueTowerExperience } from "../progression/tower.js";
import { distance } from "../core/vector.js";
import { playSound, spawnBurst, spawnParticle } from "../visuals/frost.js";
import { playGauntletSound, spawnGauntletBurst } from "../visuals/nether_gauntlet.js";
import { cleanupEncounterEntities } from "./encounter_cleanup.js";

const LICH_LOOT_TABLE = "bomd/night_lich/night_lich";

function grantExperiencePulse(dimension, location, amount, label, reserved) {
  if (amount <= 0) return;
  const orbLocation = {
    x: location.x + (Math.random() - 0.5) * 2,
    y: location.y + 0.5 + Math.random() * 1.8,
    z: location.z + (Math.random() - 0.5) * 2
  };

  let delivered = false;
  // spawnXp is a newer pre-release capability and is intentionally not part
  // of the older stable API surface. Reflective detection keeps the pack
  // compatible while using real orbs automatically on runtimes that expose it.
  const spawnXp = Reflect.get(dimension, "spawnXp");
  if (typeof spawnXp === "function") {
    delivered = attempt(() => {
      spawnXp.call(dimension, orbLocation, amount);
      return true;
    }, label) === true;
  }

  if (!delivered) {
    const nearest = dimension
      .getPlayers({ location, maxDistance: 32 })
      .sort((left, right) => distance(left.location, location) - distance(right.location, location))[0];
    if (nearest) {
      delivered = attempt(() => {
        nearest.addExperience(amount);
        return true;
      }, `${label} fallback`) === true;
    }
  }

  if (delivered && reserved) {
    consumeTowerExperience(dimension, location, amount);
  } else if (!delivered && !reserved) {
    delivered = queueTowerExperience(dimension, location, amount);
  }
  if (!delivered) {
    console.warn(`[BOMD] Could not deliver or persist ${amount} Night Lich experience.`);
  }
  spawnParticle(dimension, "minecraft:basic_portal_particle", orbLocation);
}

function distributeLichExperience(dimension, location) {
  // Reserve the entire reward on the tower before scheduling pulses. If the
  // chunk unloads during the death animation, the undelivered remainder stays
  // persistent and is paid when a player returns.
  const reserved = queueTowerExperience(dimension, location, LICH_EXPERIENCE);
  const base = Math.floor(LICH_EXPERIENCE / LICH_EXPERIENCE_PULSES);
  let remainder = LICH_EXPERIENCE - base * LICH_EXPERIENCE_PULSES;
  for (let pulse = 0; pulse < LICH_EXPERIENCE_PULSES; pulse += 1) {
    const amount = base + (remainder-- > 0 ? 1 : 0);
    schedule(6 + pulse, () => {
      grantExperiencePulse(
        dimension,
        location,
        amount,
        "grant Night Lich death experience",
        reserved
      );
    }, "Night Lich experience pulse");
  }
}

function spawnLichLoot(dimension, location) {
  const manager = world.getLootTableManager();
  const table = manager.getLootTable(LICH_LOOT_TABLE);
  if (!table) {
    console.warn("[BOMD] Night Lich loot table was unavailable during the death sequence.");
    return false;
  }
  const loot = manager.generateLootFromTable(table) ?? [];
  let index = 0;
  for (const stack of loot) {
    const angle = index * 2.399963229728653;
    const radius = 0.35 + (index % 3) * 0.18;
    attempt(
      () => dimension.spawnItem(stack, {
        x: location.x + Math.cos(angle) * radius,
        y: location.y + 0.45,
        z: location.z + Math.sin(angle) * radius
      }),
      "spawn Night Lich death loot"
    );
    index += 1;
  }
  return true;
}

function finishLichDeath(dimension, location, retry = 0) {
  if (!isLocationLoaded(dimension, location)) {
    if (retry < 60) {
      schedule(20, () => finishLichDeath(dimension, location, retry + 1), "resume Night Lich death reward");
    }
    return;
  }
  spawnLichLoot(dimension, location);
  markTowerDefeated(dimension, location);
  spawnBurst(dimension, location, 64, 3.4, SOUL_FLAME_PARTICLE);
  spawnParticle(dimension, PHASE_RUNES_PARTICLE, {
    x: location.x,
    y: location.y + 3,
    z: location.z
  });
  playSound(dimension, "bomd.night_lich.soul_star", location, 1.2, 0.72);
  world.sendMessage(translate("bomd.message.lich.defeated"));
  world.sendMessage(translate("bomd.message.lich.anima_hint"));
  recordCombatEvent("lich_death_complete", { location });
}

export function beginNightLichDeathSequence(dimension, location) {
  const center = { ...location };
  cleanupEncounterEntities(dimension, center, 100);
  playSound(dimension, "mob.skeleton.death", center, 2.2, 0.68);
  distributeLichExperience(dimension, center);

  for (let tick = 0; tick <= LICH_DEATH_SEQUENCE_TICKS; tick += 4) {
    schedule(Math.max(1, tick), () => {
      const progress = tick / LICH_DEATH_SEQUENCE_TICKS;
      spawnBurst(
        dimension,
        {
          x: center.x,
          y: center.y + 0.8 + progress * 2.2,
          z: center.z
        },
        10 + Math.floor(progress * 12),
        0.8 + progress * 1.8,
        tick % 8 === 0 ? SOUL_FLAME_PARTICLE : "bomd:frost_spark"
      );
    }, "Night Lich death particles");
  }

  schedule(
    LICH_DEATH_SEQUENCE_TICKS,
    () => finishLichDeath(dimension, center),
    "finish Night Lich death sequence"
  );
  recordCombatEvent("lich_death_start", { location: center });
}

export function beginGauntletDeathSequence(dimension, location) {
  const center = { ...location };
  playGauntletSound(dimension, "bomd.nether_gauntlet.death", center, 1.6, 1.0);
  for (let tick = 1; tick <= 50; tick += 5) {
    schedule(tick, () => {
      const progress = tick / 50;
      spawnGauntletBurst(
        dimension,
        { x: center.x, y: center.y + 0.7 + progress * 1.4, z: center.z },
        10 + Math.floor(progress * 16),
        1.0 + progress * 2.2,
        tick % 10 === 0 ? "bomd:gauntlet_smoke" : "bomd:gauntlet_spark"
      );
    }, "Nether Gauntlet death particles");
  }
  createGauntletDeathReward(dimension, center, 50);
  world.sendMessage(translate("bomd.message.gauntlet.defeated"));
  recordCombatEvent("gauntlet_death_start", { location: center });
}
