// @ts-check

import {
  ANIMATION_TICKS,
  ANIMATION_STATE,
  COMET_TYPE,
  FROST_PARTICLE
} from "../core/config.js";
import { schedule } from "../core/safe.js";
import { add, subtract } from "../core/vector.js";
import { launchProjectile } from "../projectiles/spawn_projectile.js";
import {
  playSound,
  setAnimationState,
  spawnBurst
} from "../visuals/frost.js";
import { contextActive } from "./shared.js";

function launchComet(context) {
  if (!contextActive(context)) {
    return;
  }

  const { boss, target } = context;
  const origin = add(boss.getHeadLocation(), { x: 0, y: 2, z: 0 });
  const targetPoint = {
    x: target.location.x,
    y: target.location.y + 0.9,
    z: target.location.z
  };

  launchProjectile({
    boss,
    typeId: COMET_TYPE,
    origin,
    direction: subtract(targetPoint, origin),
    speed: 1.6,
    lifetimeTicks: 220
  });

  playSound(
    boss.dimension,
    "bomd.night_lich.comet_shoot",
    boss.location,
    3,
    1
  );
}

export const comet = {
  id: "comet",
  duration: 80,
  execute(context) {
    const { boss } = context;
    if (!contextActive(context)) {
      return;
    }

    setAnimationState(boss, ANIMATION_STATE.comet);

    schedule(
      10,
      () => {
        if (contextActive(context)) {
          playSound(
            boss.dimension,
            "bomd.night_lich.comet_prepare",
            boss.location,
            3,
            1
          );
        }
      },
      "comet preparation sound"
    );

    for (let tick = 15; tick <= 58; tick += 3) {
      schedule(
        tick,
        () => {
          if (contextActive(context)) {
            spawnBurst(
              boss.dimension,
              add(boss.getHeadLocation(), { x: 0, y: 2, z: 0 }),
              9,
              0.55 + (tick - 15) * 0.018,
              FROST_PARTICLE
            );
          }
        },
        "comet telegraph"
      );
    }

    schedule(
      60,
      () => launchComet(context),
      "comet launch"
    );
    schedule(
      ANIMATION_TICKS.comet,
      () => {
        if (contextActive(context, false)) {
          setAnimationState(boss, ANIMATION_STATE.idle);
        }
      },
      "comet recovery"
    );
  }
};
