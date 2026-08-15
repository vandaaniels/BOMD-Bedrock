// @ts-check

import { VOID_ANIMATION_STATE } from "../../core/config.js";
import { playSound } from "../../visuals/frost.js";
import {
  damageAnnulus,
  eruptAnnulus,
  groundPoint,
  setVoidAnimation,
  telegraphDisc
} from "./shared.js";

const WAVES = Object.freeze([
  Object.freeze({ telegraph: 20, erupt: 50, inner: 0, outer: 7 }),
  Object.freeze({ telegraph: 45, erupt: 75, inner: 7, outer: 14 }),
  Object.freeze({ telegraph: 70, erupt: 100, inner: 14, outer: 21 })
]);

export const voidSpikeWave = {
  id: "spike_wave",
  duration: 120,
  recovery: 0,
  start({ boss, state }) {
    state.attackData.center = groundPoint(
      boss.dimension,
      boss.location,
      boss.location.y
    );
    setVoidAnimation(boss, VOID_ANIMATION_STATE.spikeWave);
  },
  tick({ boss, state, elapsed, now }) {
    const center = state.attackData.center;
    for (let index = 0; index < WAVES.length; index += 1) {
      const wave = WAVES[index];
      if (elapsed === wave.telegraph) {
        telegraphDisc(boss.dimension, center, wave.outer, true);
        playSound(
          boss.dimension,
          "bomd.void_blossom.wave_indicator",
          center,
          2,
          0.7
        );
      }
      if (elapsed === wave.erupt) {
        eruptAnnulus(boss.dimension, center, wave.inner, wave.outer);
        playSound(boss.dimension, "bomd.void_blossom.spike", center, 1.2, 1);
        damageAnnulus(
          boss,
          center,
          wave.inner,
          wave.outer,
          `wave-${index}`,
          state,
          now
        );
      }
    }
  },
  finish({ boss }) {
    setVoidAnimation(boss, VOID_ANIMATION_STATE.idle);
  }
};
