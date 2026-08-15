// @ts-check

import {
  OBSIDILITH_SPIKE_INDICATOR_PARTICLE,
  OBSIDILITH_SPIKE_PARTICLE
} from "../../../core/config.js";
import { isEntityUsable } from "../../../core/safe.js";
import { playSound } from "../../../visuals/frost.js";
import { approximateNextPosition } from "../prediction-system.js";
import { queueRiftGroup, scanDiscGroundPoints } from "../rift-system.js";

export function tickSpike(boss, data, target, positionHistory, elapsed) {
  if (![30, 60, 90].includes(elapsed) || data.fired.has(elapsed) || !isEntityUsable(target)) return;
  data.fired.add(elapsed);
  const predicted = approximateNextPosition(positionHistory, target);
  playSound(boss.dimension, "bomd.obsidilith.spike_indicator", predicted, 1, 1.1);
  scanDiscGroundPoints(boss.dimension, predicted, 2, (points, scanTicks) => {
    queueRiftGroup(boss, points, {
      indicatorParticle: OBSIDILITH_SPIKE_INDICATOR_PARTICLE,
      columnParticle: OBSIDILITH_SPIKE_PARTICLE,
      delay: Math.max(1, 20 - scanTicks),
      damage: {
        radius: 1.15,
        slownessTicks: 120,
        slownessAmplifier: 2
      },
      impactSound: "bomd.obsidilith.spike",
      impactVolume: 1.2,
      impactPitch: 1,
      maxVisualRifts: 13,
      indicatorsPerTick: 7
    });
  });
}
