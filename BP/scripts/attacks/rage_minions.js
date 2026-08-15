// @ts-check

import {
  ANIMATION_TICKS,
  ANIMATION_STATE,
  MAGIC_CIRCLE_PARTICLE,
  SOUL_FLAME_PARTICLE
} from "../core/config.js";
import { schedule } from "../core/safe.js";
import {
  playSound,
  setAnimationState,
  spawnBurst,
  spawnParticle
} from "../visuals/frost.js";
import { rageMinionDelays } from "../core/lich_logic.js";
import {
  findPhantomSummonLocation,
  spawnLichPhantom
} from "./phantom_minion.js";
import { contextActive } from "./shared.js";

const DELAYS = Object.freeze(rageMinionDelays());

function beginSingleSummon(context, index) {
  if (!contextActive(context)) {
    return;
  }

  const { boss, target } = context;
  const location = findPhantomSummonLocation(target);
  if (!location) {
    return;
  }
  spawnParticle(boss.dimension, MAGIC_CIRCLE_PARTICLE, location);
  spawnBurst(
    boss.dimension,
    location,
    15,
    0.8,
    SOUL_FLAME_PARTICLE
  );
  playSound(
    boss.dimension,
    "bomd.night_lich.minion_rune",
    location,
    1,
    0.92 + Math.random() * 0.12
  );

  schedule(
    40,
    () => {
      if (!contextActive(context)) {
        return;
      }
      if (
        !spawnLichPhantom(
          boss,
          location,
          `spawn rage phantom ${index + 1}`
        )
      ) {
        return;
      }
      spawnBurst(
        boss.dimension,
        location,
        22,
        1.1,
        SOUL_FLAME_PARTICLE
      );
      playSound(
        boss.dimension,
        "bomd.night_lich.minion_summon",
        location,
        1.1,
        1
      );
    },
    "rage phantom materialization"
  );
}

export const rageMinions = {
  id: "rage_minions",
  duration: 292,
  execute(context) {
    if (!contextActive(context)) {
      return;
    }

    const { boss } = context;
    setAnimationState(boss, ANIMATION_STATE.rage);
    playSound(
      boss.dimension,
      "bomd.night_lich.rage_prepare",
      boss.location,
      1,
      0.9
    );

    for (let index = 0; index < DELAYS.length; index += 1) {
      schedule(
        DELAYS[index],
        () => beginSingleSummon(context, index),
        "rage minion rune"
      );
    }
    schedule(
      ANIMATION_TICKS.rage,
      () => {
        if (contextActive(context, false)) {
          setAnimationState(boss, ANIMATION_STATE.idle);
        }
      },
      "rage minion animation follow-through"
    );
  }
};
