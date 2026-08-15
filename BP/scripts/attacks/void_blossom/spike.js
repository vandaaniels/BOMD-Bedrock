// @ts-check

import { VOID_ANIMATION_STATE } from "../../core/config.js";
import { attempt } from "../../core/safe.js";
import { predictedVoidTarget } from "../../core/void_blossom_logic.js";
import { playSound } from "../../visuals/frost.js";
import {
  damageDisc,
  eruptDisc,
  groundPoint,
  setVoidAnimation,
  telegraphDisc
} from "./shared.js";

const TELEGRAPH_TICKS = Object.freeze([30, 60, 90]);
const ERUPT_TICKS = Object.freeze([50, 80, 110]);

export const voidSpike = {
  id: "spike",
  duration: 150,
  recovery: 0,
  start({ boss, state }) {
    state.attackData.rifts = [];
    setVoidAnimation(boss, VOID_ANIMATION_STATE.spike);
    playSound(boss.dimension, "bomd.void_blossom.burrow", boss.location, 1.5, 1);
  },
  tick({ boss, target, state, elapsed, now }) {
    const telegraphIndex = TELEGRAPH_TICKS.indexOf(elapsed);
    if (telegraphIndex >= 0) {
      const velocity = attempt(
        () => target.getVelocity(),
        "read Void Blossom target velocity"
      ) ?? { x: 0, y: 0, z: 0 };
      const predicted = predictedVoidTarget(target.location, velocity, 8);
      const point = groundPoint(boss.dimension, predicted, boss.location.y);
      state.attackData.rifts[telegraphIndex] = point;
      telegraphDisc(boss.dimension, point, 2);
      playSound(boss.dimension, "bomd.void_blossom.spike_indicator", point, 1, 1);
    }

    const eruptIndex = ERUPT_TICKS.indexOf(elapsed);
    if (eruptIndex >= 0) {
      const point = state.attackData.rifts[eruptIndex];
      if (!point) return;
      eruptDisc(boss.dimension, point, 2);
      playSound(boss.dimension, "bomd.void_blossom.spike", point, 1.2, 1);
      damageDisc(boss, point, 2, `spike-${eruptIndex}`, state, now);
    }
  },
  finish({ boss }) {
    setVoidAnimation(boss, VOID_ANIMATION_STATE.idle);
  }
};
