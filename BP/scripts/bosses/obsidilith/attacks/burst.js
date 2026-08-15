// @ts-check

import {
  OBSIDILITH_BURST_INDICATOR_PARTICLE,
  OBSIDILITH_BURST_PARTICLE
} from "../../../core/config.js";
import { queueRiftGroup, scanDiscGroundPoints } from "../rift-system.js";

export function startBurst(boss) {
  scanDiscGroundPoints(boss.dimension, boss.location, 7, (points, scanTicks) => {
    queueRiftGroup(boss, points, {
      indicatorParticle: OBSIDILITH_BURST_INDICATOR_PARTICLE,
      columnParticle: OBSIDILITH_BURST_PARTICLE,
      delay: Math.max(1, 30 - scanTicks),
      damage: { radius: 1.15, knockup: 1.3 },
      impactSound: "bomd.obsidilith.burst",
      impactVolume: 1.2,
      impactPitch: 1,
      maxVisualRifts: 32,
      indicatorsPerTick: 8
    });
  });
}
