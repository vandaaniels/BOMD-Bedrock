// @ts-check

import { FROST_PARTICLE } from "../core/config.js";
import { attempt, isEntityUsable } from "../core/safe.js";

export function setAnimationState(boss, value) {
  if (!isEntityUsable(boss)) {
    return;
  }

  attempt(
    () => boss.setProperty("bomd:animation_state", value),
    "set animation state"
  );
  attempt(
    () => boss.setProperty("bomd:casting", value !== 0),
    "set casting compatibility property"
  );
  const glow = value === 5 ? 0 : value === 7 ? 3 : value === 0 ? 1 : 2;
  attempt(
    () => boss.setProperty("bomd:lich_glow", glow),
    "set Night Lich attack glow"
  );
}

export function spawnParticle(dimension, particleId, location) {
  try {
    const height = dimension.heightRange;
    if (
      location.y < height.min ||
      location.y >= height.max ||
      !dimension.isChunkLoaded(location)
    ) {
      return;
    }
  } catch {
    return;
  }
  attempt(
    () => dimension.spawnParticle(particleId, location),
    `spawn particle ${particleId}`
  );
}

export function spawnBurst(
  dimension,
  center,
  count = 18,
  radius = 1.5,
  particleId = FROST_PARTICLE
) {
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count;
    const vertical = ((index % 5) - 2) * 0.18;
    const location = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + 1.1 + vertical,
      z: center.z + Math.sin(angle) * radius
    };

    spawnParticle(dimension, particleId, location);
  }
}

export function spawnRing(dimension, center, radius, count = 28) {
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count;
    const location = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + 0.2,
      z: center.z + Math.sin(angle) * radius
    };

    spawnParticle(dimension, FROST_PARTICLE, location);
  }
}

export function playSound(dimension, soundId, location, volume = 1, pitch = 1) {
  attempt(
    () => dimension.playSound(soundId, location, { volume, pitch }),
    `play sound ${soundId}`
  );
}

export function announceNearby(boss, text, radius = 48) {
  if (!isEntityUsable(boss)) {
    return;
  }

  const players = attempt(
    () =>
      boss.dimension.getPlayers({
        location: boss.location,
        maxDistance: radius
      }),
    "query nearby players"
  );

  for (const player of players ?? []) {
    attempt(
      () => player.onScreenDisplay.setActionBar(text),
      "show attack warning"
    );
  }
}
