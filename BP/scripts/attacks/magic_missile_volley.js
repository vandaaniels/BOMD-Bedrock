// @ts-check

import { FROST_PARTICLE, MAGIC_MISSILE_TYPE } from "../core/config.js";
import { debugEnabled, debugLine, recordCombatEvent } from "../core/combat_debug.js";
import { regularMissileOffsetsFromView } from "../core/lich_projectile_geometry.js";
import { add, subtract } from "../core/vector.js";
import { launchProjectile } from "../projectiles/spawn_projectile.js";
import { playSound, spawnBurst } from "../visuals/frost.js";
import { contextActive } from "./shared.js";

export function regularMissileOffsets(boss) {
  return regularMissileOffsetsFromView(boss.getViewDirection());
}

function fireVolley(context) {
  if (!contextActive(context)) return;
  const { boss, target } = context;
  const bossHead = boss.getHeadLocation();
  const targetCenter = { x: target.location.x, y: target.location.y + 0.9, z: target.location.z };
  const offsets = regularMissileOffsets(boss);
  for (const offset of offsets) {
    const origin = add(bossHead, offset);
    const horizontalOffset = { x: offset.x, y: 0, z: offset.z };
    const aimPoint = add(targetCenter, horizontalOffset);
    launchProjectile({ boss, typeId: MAGIC_MISSILE_TYPE, origin, direction: subtract(aimPoint, origin), speed: 1.6 });
    if (debugEnabled("lich_projectiles")) debugLine(boss.dimension, origin, aimPoint, "minecraft:basic_portal_particle", 0.45);
  }
  recordCombatEvent("lich_regular_volley", { bossId: boss.id, targetId: target.id, offsets });
  playSound(boss.dimension, "bomd.night_lich.missile_shoot", boss.location, 3, 1);
}

export const magicMissileVolley = {
  id: "magic_missile_volley",
  duration: 80,
  execute(context) {
    if (!contextActive(context)) return;
  },
  pulse(context, pulse) {
    if (!contextActive(context, pulse !== "complete")) return;
    const { boss } = context;
    if (pulse === "prepare") {
      playSound(boss.dimension, "bomd.night_lich.missile_prepare", boss.location, 4, 1);
    } else if (pulse === "telegraph") {
      const count = (context.attackData.telegraphCount = (context.attackData.telegraphCount ?? 0) + 1);
      spawnBurst(boss.dimension, boss.getHeadLocation(), 10, 0.7 + count * 0.14, FROST_PARTICLE);
    } else if (pulse === "launch") {
      fireVolley(context);
    }
  }
};
