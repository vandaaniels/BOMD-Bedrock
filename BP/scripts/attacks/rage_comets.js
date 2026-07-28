// @ts-check

import { COMET_TYPE, FROST_PARTICLE } from "../core/config.js";
import { add, normalize, scale, subtract } from "../core/vector.js";
import { launchProjectile } from "../projectiles/spawn_projectile.js";
import { playSound, spawnBurst } from "../visuals/frost.js";
import { contextActive } from "./shared.js";

function cross(left, right) {
  return { x: left.y * right.z - left.z * right.y, y: left.z * right.x - left.x * right.z, z: left.x * right.y - left.y * right.x };
}

function rageCometOffsets(boss, target) {
  const forward = normalize(subtract(target.getHeadLocation(), boss.getHeadLocation()));
  const rawRight = cross(forward, { x: 0, y: 1, z: 0 });
  const right = Math.abs(rawRight.x) + Math.abs(rawRight.z) < 0.001 ? { x: 1, y: 0, z: 0 } : normalize(rawRight);
  const up = normalize(cross(right, forward));
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (index * Math.PI * 2) / 6;
    return add(scale(right, Math.cos(angle) * 3), scale(up, Math.sin(angle) * 3));
  });
}

function launch(context, index) {
  if (!contextActive(context)) return;
  const { boss, target, attackData } = context;
  const offset = attackData.offsets?.[index];
  if (!offset) return;
  const origin = add(boss.getHeadLocation(), offset);
  const aim = { x: target.location.x, y: target.location.y + 0.9, z: target.location.z };
  launchProjectile({ boss, typeId: COMET_TYPE, origin, direction: subtract(aim, origin), speed: 1.6, lifetimeTicks: 220 });
  spawnBurst(boss.dimension, origin, 16, 0.65, FROST_PARTICLE);
  playSound(boss.dimension, "bomd.night_lich.comet_shoot", boss.location, 3, 1);
}

export const rageComets = {
  id: "rage_comets",
  duration: 240,
  execute(context) {
    if (!contextActive(context)) return;
    context.attackData.offsets = rageCometOffsets(context.boss, context.target);
  },
  pulse(context, pulse) {
    if (!contextActive(context, pulse !== "complete")) return;
    const { boss, attackData } = context;
    if (pulse === "prepare") {
      playSound(boss.dimension, "bomd.night_lich.rage_prepare", boss.location, 1, 1);
      return;
    }
    const match = /^(telegraph|launch)_(\d+)$/.exec(pulse);
    if (!match) return;
    const index = Number(match[2]);
    const offset = attackData.offsets?.[index];
    if (!offset) return;
    if (match[1] === "telegraph") {
      spawnBurst(boss.dimension, add(boss.getHeadLocation(), offset), 8, 0.45, FROST_PARTICLE);
    } else {
      launch(context, index);
    }
  }
};
