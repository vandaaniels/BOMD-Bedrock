// @ts-check

import {
  GAUNTLET_ANIMATION_STATE,
  GAUNTLET_ENERGY_PARTICLE,
  GAUNTLET_LASER_DAMAGE
} from "../../core/config.js";
import { destroyGauntletRayBlock } from "../../core/explosion.js";
import { pointSegmentDistance } from "../../core/oriented_box.js";
import { add, normalize, scale, subtract } from "../../core/vector.js";
import { playSound, spawnParticle } from "../../visuals/frost.js";
import {
  gauntletBeamTrace,
  gauntletEyeOrigin,
  removeGauntletBeamEntity,
  spawnGauntletBeam,
  spawnGauntletImpact,
  updateGauntletBeamEntity
} from "../../visuals/gauntlet.js";
import {
  combatPlayers,
  damagePlayer,
  setGauntletAnimation,
  setGauntletEnergy,
  setGauntletEyeOpen,
  setGauntletHandClosed
} from "./shared.js";

// Java aims the laser at the target bounding-box center rather than at the
// head. Script API does not expose a stable LivingEntity collision-box
// component across the supported Bedrock builds, so use the standing-player
// center directly instead of depending on an optional runtime component.
function laserTargetCenter(target) {
  return {
    x: target.location.x,
    y: target.location.y + 0.9,
    z: target.location.z
  };
}

function directionToPoint(origin, point) {
  return normalize(subtract(point, origin));
}

function damageLaserPlayers(context, origin, direction, beamDistance) {
  const { boss, state, now } = context;
  const data = state.attackData;
  const end = add(origin, scale(direction, beamDistance));
  const players = combatPlayers(boss.dimension, boss.location, 48);

  for (const player of players) {
    const center = laserTargetCenter(player);
    // The Java renderer and hit test use the same eye-to-target segment. A
    // small radius compensates for Bedrock player hitboxes without aiming over
    // the player's head.
    if (pointSegmentDistance(center, origin, end) > 1.15) continue;
    const lastHit = data.lastHitTicks.get(player.id) ?? -1000;
    if (now - lastHit < 10) {
      continue;
    }
    data.lastHitTicks.set(player.id, now);
    damagePlayer(
      player,
      boss,
      GAUNTLET_LASER_DAMAGE,
      "damage with Nether Gauntlet delayed laser"
    );
  }
}

export const gauntletLaser = {
  id: "laser",
  duration: 100,
  recovery: 10,
  movement: "hover",

  start(context) {
    const { boss, target, state } = context;
    state.attackData = {
      targetHistory: [laserTargetCenter(target)],
      lastHitTicks: new Map(),
      beamEntityId: undefined
    };
    setGauntletEnergy(boss, 1);
    setGauntletEyeOpen(boss, true);
    setGauntletHandClosed(boss, false);
    setGauntletAnimation(boss, GAUNTLET_ANIMATION_STATE.laser);
    playSound(
      boss.dimension,
      "bomd.nether_gauntlet.laser_charge",
      boss.location,
      3,
      1
    );
  },

  tick(context) {
    const { boss, target, state, elapsed } = context;
    const data = state.attackData;
    const origin = gauntletEyeOrigin(boss);

    if (elapsed < 25) {
      const direction = directionToPoint(origin, laserTargetCenter(target));
      if (elapsed >= 10 && elapsed % 2 === 0) {
        const trace = gauntletBeamTrace(
          boss.dimension,
          origin,
          direction,
          30
        );
        const beamDistance = trace.distance;
        updateGauntletBeamEntity(
          boss,
          data,
          origin,
          direction,
          beamDistance,
          false
        );
        spawnGauntletBeam(
          boss.dimension,
          origin,
          direction,
          beamDistance,
          true
        );
      }
      if (elapsed % 2 === 0) {
        const angle = elapsed * 0.82;
        spawnParticle(boss.dimension, GAUNTLET_ENERGY_PARTICLE, {
          x: origin.x + Math.cos(angle) * 0.72,
          y: origin.y + Math.sin(angle * 0.65) * 0.5,
          z: origin.z + Math.sin(angle) * 0.72
        });
      }
      return;
    }

    if (elapsed <= 84) {
      data.targetHistory.push(laserTargetCenter(target));
      if (data.targetHistory.length > 8) {
        data.targetHistory.shift();
      }
      if (data.targetHistory.length < 8) {
        return;
      }
      const delayedPoint = data.targetHistory[0];
      const direction = directionToPoint(origin, delayedPoint);
      const trace = gauntletBeamTrace(
        boss.dimension,
        origin,
        direction,
        30
      );
      const beamDistance = trace.distance;
      updateGauntletBeamEntity(
        boss,
        data,
        origin,
        direction,
        beamDistance,
        true
      );
      if (elapsed % 2 === 0) {
        spawnGauntletImpact(
          boss.dimension,
          {
            x: origin.x + direction.x * beamDistance,
            y: origin.y + direction.y * beamDistance,
            z: origin.z + direction.z * beamDistance
          },
          6
        );
        damageLaserPlayers(context, origin, direction, beamDistance);
        if (trace.hit) {
          destroyGauntletRayBlock(trace.hit);
        }
      }
    }

    if (elapsed === 85) {
      removeGauntletBeamEntity(data);
      setGauntletEnergy(boss, 0);
      setGauntletAnimation(boss, GAUNTLET_ANIMATION_STATE.laserStop);
    }
  },

  finish(context) {
    removeGauntletBeamEntity(context.state.attackData);
    setGauntletEnergy(context.boss, 0);
    setGauntletEyeOpen(context.boss, true);
    setGauntletHandClosed(context.boss, false);
    setGauntletAnimation(context.boss, GAUNTLET_ANIMATION_STATE.idle);
  }
};
