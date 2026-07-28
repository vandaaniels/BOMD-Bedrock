// @ts-check

import { COMET_TYPE, FROST_PARTICLE } from "../core/config.js";
import { add, subtract } from "../core/vector.js";
import { launchProjectile } from "../projectiles/spawn_projectile.js";
import { playSound, spawnBurst } from "../visuals/frost.js";
import { contextActive } from "./shared.js";

function launchComet(context) {
  if (!contextActive(context)) return;
  const { boss, target } = context;
  const origin = add(boss.getHeadLocation(), { x: 0, y: 2, z: 0 });
  const targetPoint = { x: target.location.x, y: target.location.y + 0.9, z: target.location.z };
  launchProjectile({ boss, typeId: COMET_TYPE, origin, direction: subtract(targetPoint, origin), speed: 1.6, lifetimeTicks: 220 });
  playSound(boss.dimension, "bomd.night_lich.comet_shoot", boss.location, 3, 1);
}

export const comet = {
  id: "comet",
  duration: 80,
  execute(context) {
    if (!contextActive(context)) return;
  },
  pulse(context, pulse) {
    if (!contextActive(context, pulse !== "complete")) return;
    const { boss } = context;
    if (pulse === "prepare") {
      playSound(boss.dimension, "bomd.night_lich.comet_prepare", boss.location, 3, 1);
    } else if (pulse === "telegraph") {
      const count = (context.attackData.telegraphCount = (context.attackData.telegraphCount ?? 0) + 1);
      spawnBurst(boss.dimension, add(boss.getHeadLocation(), { x: 0, y: 2, z: 0 }), 9, 0.55 + count * 0.054, FROST_PARTICLE);
    } else if (pulse === "launch") {
      launchComet(context);
    }
  }
};
