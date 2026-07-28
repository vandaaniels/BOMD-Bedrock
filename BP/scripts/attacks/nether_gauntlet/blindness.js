// @ts-check

import { GAUNTLET_SPARK_PARTICLE } from "../../core/gauntlet_config.js";
import { scaleBossEffectTicks } from "../../core/difficulty.js";
import { attempt } from "../../core/safe.js";
import { playGauntletSound, spawnGauntletBurst } from "../../visuals/nether_gauntlet.js";
import { gauntletContextActive } from "./shared.js";

export const blindness = {
  id: "blindness",
  duration: 80,
  execute(context) {
    if (!gauntletContextActive(context, false)) return;
  },
  pulse(context, pulse) {
    const { boss } = context;
    if (!gauntletContextActive(context, false)) return;
    if (pulse === "begin") {
      playGauntletSound(boss.dimension, "bomd.nether_gauntlet.cast", boss.location, 1.5, 1.0);
      return;
    }
    if (pulse === "burst") {
      for (const player of boss.dimension.getPlayers({ location: boss.location, maxDistance: 64 })) {
        spawnGauntletBurst(boss.dimension, {
          x: player.location.x,
          y: player.location.y + 1.2,
          z: player.location.z
        }, 16, 0.8, GAUNTLET_SPARK_PARTICLE);
      }
      return;
    }
    if (pulse === "apply") {
      const duration = scaleBossEffectTicks(140);
      for (const player of boss.dimension.getPlayers({ location: boss.location, maxDistance: 64 })) {
        attempt(() => player.addEffect("blindness", duration, {
          amplifier: 0,
          showParticles: false
        }), "apply Gauntlet blindness");
      }
    }
  }
};
