// @ts-check

import {
  ANIMATION_TICKS,
  ANIMATION_STATE,
  FROST_PARTICLE,
  MAGIC_MISSILE_TYPE
} from "../core/config.js";
import { schedule } from "../core/safe.js";
import {
  add,
  normalize,
  scale,
  subtract
} from "../core/vector.js";
import { launchProjectile } from "../projectiles/spawn_projectile.js";
import {
  playSound,
  setAnimationState,
  spawnBurst
} from "../visuals/frost.js";
import { contextActive } from "./shared.js";

function basis(boss, target) {
  const forward = normalize(
    subtract(
      {
        x: target.location.x,
        y: target.location.y + 0.9,
        z: target.location.z
      },
      boss.getHeadLocation()
    )
  );
  const rawRight = { x: -forward.z, y: 0, z: forward.x };
  const right =
    Math.abs(rawRight.x) + Math.abs(rawRight.z) < 0.001
      ? { x: 1, y: 0, z: 0 }
      : normalize(rawRight);
  const up = normalize({
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x
  });
  return { forward, right, up };
}

function lineOffsets(right, up, mode) {
  const offsets = [];
  for (let index = -4; index <= 4; index += 1) {
    if (mode === "horizontal") {
      offsets.push(scale(right, index));
    } else if (mode === "vertical") {
      offsets.push(scale(up, index));
    } else if (mode === "diagonal_up") {
      offsets.push(
        add(
          scale(right, index * Math.SQRT1_2),
          scale(up, index * Math.SQRT1_2)
        )
      );
    } else {
      offsets.push(
        add(
          scale(right, index * Math.SQRT1_2),
          scale(up, -index * Math.SQRT1_2)
        )
      );
    }
  }
  return offsets;
}

function formationOffsets(right, up, formation) {
  if (formation === "horizontal") {
    return lineOffsets(right, up, "horizontal");
  }
  if (formation === "vertical") {
    return lineOffsets(right, up, "vertical");
  }
  if (formation === "cross") {
    return [
      ...lineOffsets(right, up, "horizontal"),
      ...lineOffsets(right, up, "vertical")
    ];
  }
  return [
    ...lineOffsets(right, up, "diagonal_up"),
    ...lineOffsets(right, up, "diagonal_down")
  ];
}

function fireFormation(context, formation) {
  if (!contextActive(context)) {
    return;
  }

  const { boss, target } = context;
  const { forward, right, up } = basis(boss, target);
  const forwardOffset = scale(forward, 3);
  const targetCenter = {
    x: target.location.x,
    y: target.location.y + 0.9,
    z: target.location.z
  };

  for (const offset of formationOffsets(right, up, formation)) {
    const fullOffset = add(forwardOffset, offset);
    const origin = add(boss.getHeadLocation(), fullOffset);
    const aim = add(targetCenter, fullOffset);
    launchProjectile({
      boss,
      typeId: MAGIC_MISSILE_TYPE,
      origin,
      direction: subtract(aim, origin),
      speed: 1.6,
      lifetimeTicks: 180
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

export const rageMissiles = {
  id: "rage_missiles",
  duration: 180,
  execute(context) {
    if (!contextActive(context)) {
      return;
    }

    const { boss, target } = context;
    const formations = ["horizontal", "vertical", "cross", "x"];
    setAnimationState(boss, ANIMATION_STATE.rage);
    playSound(
      boss.dimension,
      "bomd.night_lich.missile_prepare",
      boss.location,
      4,
      1
    );

    for (let index = 0; index < formations.length; index += 1) {
      const launchTick = 60 + index * 30;
      const formation = formations[index];
      schedule(
        launchTick - 30,
        () => {
          if (!contextActive(context)) {
            return;
          }
          const { forward, right, up } = basis(boss, target);
          const forwardOffset = scale(forward, 3);
          for (const offset of formationOffsets(right, up, formation)) {
            spawnBurst(
              boss.dimension,
              add(
                boss.getHeadLocation(),
                add(forwardOffset, offset)
              ),
              3,
              0.18,
              FROST_PARTICLE
            );
          }
        },
        "rage missile formation telegraph"
      );
      schedule(
        launchTick,
        () => fireFormation(context, formation),
        "rage missile formation"
      );
    }

    schedule(
      ANIMATION_TICKS.rage,
      () => {
        if (contextActive(context, false)) {
          setAnimationState(boss, ANIMATION_STATE.idle);
        }
      },
      "rage missile animation follow-through"
    );
  }
};
