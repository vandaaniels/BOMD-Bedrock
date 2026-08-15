// @ts-check

import {
  OBSIDILITH_WAVE_INDICATOR_PARTICLE,
  OBSIDILITH_WAVE_PARTICLE
} from "../../../core/config.js";
import { normalize } from "../../../core/vector.js";
import { playSound } from "../../../visuals/frost.js";
import { queueRiftGroup, scanDiscGroundPoints } from "../rift-system.js";

export function tickWave(boss, data, elapsed) {
  if (elapsed < 20 || elapsed > 52 || (elapsed - 20) % 8 !== 0 || data.fired.has(elapsed)) return;
  data.fired.add(elapsed);
  const step = (elapsed - 20) / 8;
  const direction = normalize({
    x: data.target.x - boss.location.x,
    y: 0,
    z: data.target.z - boss.location.z
  });
  // Java interpolates five points from 4 through 34 blocks.
  const distanceFromBoss = 4 + step * 7.5;
  const center = {
    x: boss.location.x + direction.x * distanceFromBoss,
    y: boss.location.y,
    z: boss.location.z + direction.z * distanceFromBoss
  };
  playSound(boss.dimension, "bomd.obsidilith.wave_indicator", center, 0.7, 1);
  scanDiscGroundPoints(boss.dimension, center, 4, (points, scanTicks) => {
    queueRiftGroup(boss, points, {
      indicatorParticle: OBSIDILITH_WAVE_INDICATOR_PARTICLE,
      columnParticle: OBSIDILITH_WAVE_PARTICLE,
      delay: Math.max(1, 20 - scanTicks),
      damage: { radius: 1.15, knockup: 0.8, fireSeconds: 5 },
      impactSound: "mob.ghast.fireball",
      impactVolume: 1.2,
      impactPitch: 1,
      maxVisualRifts: 18,
      indicatorsPerTick: 6
    });
  });
}
