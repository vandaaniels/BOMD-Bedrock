// @ts-check

import { FROST_PARTICLE, MAGIC_MISSILE_TYPE } from "../core/config.js";
import { debugEnabled, debugLine, recordCombatEvent } from "../core/combat_debug.js";
import { rageFormationOffsetsFromView } from "../core/lich_projectile_geometry.js";
import { add, subtract } from "../core/vector.js";
import { launchProjectile } from "../projectiles/spawn_projectile.js";
import { playSound, spawnBurst } from "../visuals/frost.js";
import { contextActive } from "./shared.js";

export function rageFormationOffsets(boss, formation) {
  return rageFormationOffsetsFromView(boss.getViewDirection(), formation);
}

function fireFormation(context, formation) {
  if (!contextActive(context)) return;
  const { boss, target } = context;
  const targetCenter = { x: target.location.x, y: target.location.y + 0.9, z: target.location.z };
  const offsets = rageFormationOffsets(boss, formation);
  for (const offset of offsets) {
    const origin = add(boss.getHeadLocation(), offset);
    const aim = add(targetCenter, offset);
    launchProjectile({ boss, typeId: MAGIC_MISSILE_TYPE, origin, direction: subtract(aim, origin), speed: 1.6, lifetimeTicks: 180 });
    if (debugEnabled("lich_projectiles")) debugLine(boss.dimension, origin, aim, "minecraft:basic_portal_particle", 0.5);
  }
  recordCombatEvent("lich_rage_volley", { bossId: boss.id, targetId: target.id, formation, projectileCount: offsets.length });
  playSound(boss.dimension, "bomd.night_lich.missile_shoot", boss.location, 3, 1);
}

export const rageMissiles = {
  id: "rage_missiles",
  duration: 180,
  execute(context) {
    if (!contextActive(context)) return;
  },
  pulse(context, pulse) {
    if (!contextActive(context, pulse !== "complete")) return;
    const { boss } = context;
    if (pulse === "prepare") {
      playSound(boss.dimension, "bomd.night_lich.missile_prepare", boss.location, 4, 1);
      return;
    }
    const match = /^(telegraph|launch)_(horizontal|vertical|cross|x)$/.exec(pulse);
    if (!match) return;
    const formation = match[2];
    if (match[1] === "telegraph") {
      for (const offset of rageFormationOffsets(boss, formation)) {
        spawnBurst(boss.dimension, add(boss.getHeadLocation(), offset), 3, 0.18, FROST_PARTICLE);
      }
    } else {
      fireFormation(context, formation);
    }
  }
};
