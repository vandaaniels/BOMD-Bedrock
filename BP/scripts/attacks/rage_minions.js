// @ts-check

import { MAGIC_CIRCLE_PARTICLE, SOUL_FLAME_PARTICLE } from "../core/config.js";
import { playSound, spawnBurst, spawnParticle } from "../visuals/frost.js";
import { findPhantomSummonLocation, spawnLichPhantom } from "./phantom_minion.js";
import { contextActive } from "./shared.js";

function createRune(context, index) {
  if (!contextActive(context)) return;
  const { boss, target, attackData } = context;
  const location = findPhantomSummonLocation(target);
  if (!location) return;
  attackData.locations[index] = location;
  spawnParticle(boss.dimension, MAGIC_CIRCLE_PARTICLE, location);
  spawnBurst(boss.dimension, location, 15, 0.8, SOUL_FLAME_PARTICLE);
  playSound(boss.dimension, "bomd.night_lich.minion_rune", location, 1, 0.92 + Math.random() * 0.12);
}

function materialize(context, index) {
  if (!contextActive(context)) return;
  const { boss, target, attackData } = context;
  const location = attackData.locations[index];
  if (!location) return;
  if (!spawnLichPhantom(boss, target, location, `spawn rage phantom ${index + 1}`)) return;
  spawnBurst(boss.dimension, location, 22, 1.1, SOUL_FLAME_PARTICLE);
  playSound(boss.dimension, "bomd.night_lich.minion_summon", location, 1.1, 1);
}

export const rageMinions = {
  id: "rage_minions",
  duration: 294,
  execute(context) {
    if (!contextActive(context)) return;
    context.attackData.locations = [];
  },
  pulse(context, pulse) {
    if (!contextActive(context, pulse !== "complete")) return;
    const { boss } = context;
    if (pulse === "prepare") {
      playSound(boss.dimension, "bomd.night_lich.rage_prepare", boss.location, 1, 0.9);
      return;
    }
    const match = /^(rune|spawn)_(\d+)$/.exec(pulse);
    if (!match) return;
    const index = Number(match[2]);
    if (match[1] === "rune") createRune(context, index);
    else materialize(context, index);
  }
};
