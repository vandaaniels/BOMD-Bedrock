// @ts-check

import {
  ANIMATION_TICKS,
  ANIMATION_STATE,
  MAGIC_CIRCLE_PARTICLE,
  SOUL_FLAME_PARTICLE
} from "../core/config.js";
import { REGULAR_PHANTOM_COUNT } from "../core/lich_logic.js";
import { schedule } from "../core/safe.js";
import {
  playSound,
  setAnimationState,
  spawnBurst,
  spawnParticle
} from "../visuals/frost.js";
import {
  findPhantomSummonLocation,
  spawnLichPhantom
} from "./phantom_minion.js";
import { contextActive } from "./shared.js";

function spawnMinions(context, locations) {
  if (!contextActive(context, false)) {
    return;
  }

  const { boss } = context;
  for (const location of locations) {
    if (!spawnLichPhantom(boss, location, "spawn lich phantom")) {
      continue;
    }

    spawnBurst(
      boss.dimension,
      location,
      22,
      1.1,
      SOUL_FLAME_PARTICLE
    );
  }

  playSound(
    boss.dimension,
    "bomd.night_lich.minion_summon",
    boss.location,
    1.2,
    1
  );
}

export const summonPhantoms = {
  id: "summon_phantoms",
  duration: 81,
  execute(context) {
    const { boss, target } = context;
    if (!contextActive(context)) {
      return;
    }

    setAnimationState(boss, ANIMATION_STATE.minions);
    const count = REGULAR_PHANTOM_COUNT;
    let locations = [];

    schedule(
      40,
      () => {
        if (!contextActive(context)) {
          return;
        }
        locations = [];
        for (let index = 0; index < count; index += 1) {
          const location = findPhantomSummonLocation(target);
          if (location) {
            locations.push(location);
          }
        }
        for (const location of locations) {
          spawnParticle(
            boss.dimension,
            MAGIC_CIRCLE_PARTICLE,
            location
          );
          spawnBurst(
            boss.dimension,
            location,
            14,
            0.8,
            SOUL_FLAME_PARTICLE
          );
        }
        playSound(
          boss.dimension,
          "bomd.night_lich.minion_rune",
          target.location,
          1,
          1
        );
      },
      "minion runes"
    );

    // Keep Java's exact 40-tick rune + 40-tick materialization timing. The
    // attack itself remains active for one extra tick so the manager cannot
    // advance castSerial before this callback resolves.
    schedule(
      80,
      () => spawnMinions(context, locations),
      "minion summon"
    );
    schedule(
      ANIMATION_TICKS.minions,
      () => {
        if (contextActive(context, false)) {
          setAnimationState(boss, ANIMATION_STATE.idle);
        }
      },
      "minion animation follow-through"
    );
  }
};
