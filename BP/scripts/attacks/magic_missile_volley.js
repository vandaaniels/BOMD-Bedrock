// @ts-check

import {
  ANIMATION_TICKS,
  ANIMATION_STATE,
  FROST_PARTICLE,
  MAGIC_MISSILE_TYPE
} from "../core/config.js";
import { schedule } from "../core/safe.js";
import { add, normalize, scale, subtract } from "../core/vector.js";
import { launchProjectile } from "../projectiles/spawn_projectile.js";
import {
  playSound,
  setAnimationState,
  spawnBurst
} from "../visuals/frost.js";
import { contextActive } from "./shared.js";

function rightVector(forward) {
  const right = {
    x: -forward.z,
    y: 0,
    z: forward.x
  };
  if (Math.abs(right.x) + Math.abs(right.z) < 0.001) {
    return { x: 1, y: 0, z: 0 };
  }
  return normalize(right);
}

function upVector(forward, right) {
  return normalize({
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x
  });
}

function fireVolley(context) {
  if (!contextActive(context)) {
    return;
  }

  const { boss, target } = context;
  const bossHead = boss.getHeadLocation();
  const targetCenter = {
    x: target.location.x,
    y: target.location.y + 0.9,
    z: target.location.z
  };
  const forward = normalize(subtract(targetCenter, bossHead));
  const right = rightVector(forward);
  const up = upVector(forward, right);
  const projectileCount = 5;

  for (let index = 0; index < projectileCount; index += 1) {
    const center = (projectileCount - 1) / 2;
    const lateral = index - center;
    const arch = 2 - Math.abs(lateral) * 0.5;
    const horizontalOffset = scale(right, lateral);
    const launchOffset = add(
      horizontalOffset,
      scale(up, arch)
    );
    const origin = add(bossHead, launchOffset);
    const aimPoint = add(targetCenter, {
      x: launchOffset.x,
      y: 0,
      z: launchOffset.z
    });

    launchProjectile({
      boss,
      typeId: MAGIC_MISSILE_TYPE,
      origin,
      direction: subtract(aimPoint, origin),
      speed: 1.6
    });
  }

  playSound(
    boss.dimension,
    "bomd.night_lich.missile_shoot",
    boss.location,
    3,
    1
  );
}

export const magicMissileVolley = {
  id: "magic_missile_volley",
  duration: 80,
  execute(context) {
    const { boss } = context;
    if (!contextActive(context)) {
      return;
    }

    setAnimationState(boss, ANIMATION_STATE.missiles);

    schedule(
      10,
      () => {
        if (contextActive(context)) {
          playSound(
            boss.dimension,
            "bomd.night_lich.missile_prepare",
            boss.location,
            4,
            1
          );
        }
      },
      "missile preparation sound"
    );

    for (let tick = 16; tick <= 44; tick += 4) {
      schedule(
        tick,
        () => {
          if (contextActive(context)) {
            spawnBurst(
              boss.dimension,
              boss.getHeadLocation(),
              10,
              0.7 + (tick - 16) * 0.035,
              FROST_PARTICLE
            );
          }
        },
        "missile telegraph"
      );
    }

    schedule(
      46,
      () => fireVolley(context),
      "missile volley"
    );
    schedule(
      ANIMATION_TICKS.missiles,
      () => {
        if (contextActive(context, false)) {
          setAnimationState(boss, ANIMATION_STATE.idle);
        }
      },
      "missile recovery"
    );
  }
};
