// @ts-check

import { world } from "@minecraft/server";

import {
  GAUNTLET_ANIMATION_STATE,
  GAUNTLET_ENERGY_PARTICLE
} from "../../core/config.js";
import { attempt, isEntityUsable } from "../../core/safe.js";
import { playSound, spawnParticle } from "../../visuals/frost.js";
import { gauntletEyeOrigin } from "../../visuals/gauntlet.js";
import {
  combatPlayers,
  setGauntletAnimation,
  setGauntletEnergy,
  setGauntletEyeOpen,
  setGauntletHandClosed
} from "./shared.js";

function blindnessTargets(boss) {
  return combatPlayers(boss.dimension, boss.location, 68).filter((player) => {
    const dx = player.location.x - boss.location.x;
    const dz = player.location.z - boss.location.z;
    return dx * dx + dz * dz <= 64 * 64 &&
      Math.abs(player.location.y - boss.location.y) <= 32;
  });
}

function markedPlayers(targetIds) {
  return targetIds
    .map((id) => attempt(() => world.getEntity(id), "resolve Gauntlet blindness mark"))
    .filter((entity) => isEntityUsable(entity) && entity.typeId === "minecraft:player");
}

function renderMarkedEyes(boss, targetIds, elapsed) {
  const players = markedPlayers(targetIds);
  for (const player of players) {
    const baseAngle = elapsed * 0.22;
    // Java creates 21 continuously rotating EYE particles spanning the player
    // vertically. Bedrock cannot bind a particle to an entity transform, so
    // refresh a representative rotating set every other tick.
    for (let index = 0; index < 7; index += 1) {
      const angle = baseAngle + index * (Math.PI * 2 / 7);
      spawnParticle(boss.dimension, "bomd:gauntlet_eye", {
        x: player.location.x + Math.cos(angle),
        y: player.location.y + 0.15 + index * 0.27,
        z: player.location.z + Math.sin(angle)
      });
    }
  }
}

export const blindnessCast = {
  id: "blindness",
  duration: 81,
  recovery: 10,
  movement: "hover",

  start(context) {
    const { boss, state } = context;
    state.attackData = {
      targetIds: []
    };
    setGauntletAnimation(
      boss,
      GAUNTLET_ANIMATION_STATE.blindness
    );
    setGauntletEnergy(boss, 1);
    playSound(
      boss.dimension,
      "bomd.nether_gauntlet.cast",
      boss.location,
      2.2,
      1
    );
  },

  tick(context) {
    const { boss, state, elapsed } = context;
    const data = state.attackData;
    if (elapsed === 10) {
      setGauntletEyeOpen(boss, false);
      setGauntletHandClosed(boss, true);
      setGauntletEnergy(boss, 2);
    }
    if (elapsed === 30) {
      data.targetIds = blindnessTargets(boss).map((player) => player.id);
    }
    if (elapsed >= 30 && elapsed < 80 && elapsed % 2 === 0) {
      renderMarkedEyes(boss, data.targetIds, elapsed);
    }
    if (elapsed >= 10 && elapsed <= 52 && elapsed % 2 === 0) {
      const origin = gauntletEyeOrigin(boss);
      const angle = elapsed * 0.55;
      for (const radius of [0.65, 1.1]) {
        spawnParticle(
          boss.dimension,
          GAUNTLET_ENERGY_PARTICLE,
          {
            x: origin.x + Math.cos(angle + radius) * radius,
            y: origin.y + Math.sin(angle * 0.7 + radius) * 0.7,
            z: origin.z + Math.sin(angle + radius) * radius
          }
        );
      }
    }
    if (elapsed === 43) {
      setGauntletEyeOpen(boss, true);
      setGauntletHandClosed(boss, false);
      setGauntletEnergy(boss, 1);
    }
    if (elapsed === 80) {
      // Keep the tick-30 target snapshot exactly like Java; moving out of the
      // radius after being marked does not clear the pending blindness.
      for (const player of markedPlayers(data.targetIds)) {
        attempt(
          () =>
            player.addEffect("minecraft:blindness", 140, {
              amplifier: 0,
              showParticles: false
            }),
          "apply Nether Gauntlet blindness"
        );
      }
      playSound(
        boss.dimension,
        "bomd.nether_gauntlet.energy_shield",
        boss.location,
        1.5,
        0.62
      );
    }
  },

  finish(context) {
    setGauntletAnimation(
      context.boss,
      GAUNTLET_ANIMATION_STATE.idle
    );
    setGauntletEnergy(context.boss, 0);
    setGauntletEyeOpen(context.boss, true);
    setGauntletHandClosed(context.boss, false);
  }
};
