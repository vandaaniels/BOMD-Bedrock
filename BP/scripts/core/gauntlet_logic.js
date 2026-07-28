// @ts-check

import {
  GAUNTLET_BLINDNESS_UNLOCK,
  GAUNTLET_LASER_UNLOCK,
  GAUNTLET_SWIRL_UNLOCK
} from "./gauntlet_config.js";

export function appendGauntletHistory(history, attackId) {
  return [...history, attackId].slice(-4);
}

/**
 * Faithful port of GauntletMoveLogic.chooseMove from BOMD.
 * @param {{healthPercentage:number, history?:string[], randomValue?:number}} options
 */
export function gauntletAttackWeights({ healthPercentage, history = [] }) {
  const previous = history.length > 0 ? history[history.length - 1] : undefined;
  return {
    punch: 1.0,
    laser: previous === "laser" || healthPercentage >= GAUNTLET_LASER_UNLOCK ? 0 : 0.7,
    swirl_punch: previous === "swirl_punch" || healthPercentage >= GAUNTLET_SWIRL_UNLOCK ? 0 : 0.7,
    blindness: history.includes("blindness") || healthPercentage >= GAUNTLET_BLINDNESS_UNLOCK ? 0 : 1.0
  };
}

export function chooseGauntletAttack({ healthPercentage, history = [], randomValue = Math.random() }) {
  const weights = gauntletAttackWeights({ healthPercentage, history });
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = Math.max(0, Math.min(0.999999, randomValue)) * total;
  for (const [id, weight] of entries) {
    cursor -= weight;
    if (cursor <= 0) return id;
  }
  return entries.length > 0 ? entries[entries.length - 1][0] : "punch";
}
