// @ts-check

import { MAGIC_CIRCLE_PARTICLE, SOUL_FLAME_PARTICLE } from "../core/config.js";
import { REGULAR_PHANTOM_COUNT } from "../core/lich_logic.js";
import { playSound, spawnBurst, spawnParticle } from "../visuals/frost.js";
import { findPhantomSummonLocation, spawnLichPhantom } from "./phantom_minion.js";
import { contextActive } from "./shared.js";

function spawnMinions(context) {
  if (!contextActive(context, false)) return;
  const { boss, target, attackData } = context;
  for (const location of attackData.locations ?? []) {
    if (!spawnLichPhantom(boss, target, location, "spawn lich phantom")) continue;
    spawnBurst(boss.dimension, location, 22, 1.1, SOUL_FLAME_PARTICLE);
  }
  playSound(boss.dimension, "bomd.night_lich.minion_summon", boss.location, 1.2, 1);
}

export const summonPhantoms = {
  id: "summon_phantoms",
  duration: 81,
  execute(context) {
    if (!contextActive(context)) return;
    context.attackData.locations = [];
  },
  pulse(context, pulse) {
    if (!contextActive(context, pulse !== "complete")) return;
    const { boss, target, attackData } = context;
    if (pulse === "runes") {
      attackData.locations = [];
      for (let index = 0; index < REGULAR_PHANTOM_COUNT; index += 1) {
        const location = findPhantomSummonLocation(target);
        if (location) attackData.locations.push(location);
      }
      for (const location of attackData.locations) {
        spawnParticle(boss.dimension, MAGIC_CIRCLE_PARTICLE, location);
        spawnBurst(boss.dimension, location, 14, 0.8, SOUL_FLAME_PARTICLE);
      }
      playSound(boss.dimension, "bomd.night_lich.minion_rune", target.location, 1, 1);
    } else if (pulse === "summon") {
      spawnMinions(context);
    }
  }
};
