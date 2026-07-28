// @ts-check

import {
  GAUNTLET_ANIMATION_STATE,
  GAUNTLET_EYE_OPEN_PROPERTY,
  GAUNTLET_SPARK_PARTICLE,
  GAUNTLET_VISUAL_STATE
} from "../core/gauntlet_config.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import { clampEntityLocation, isLocationLoaded, isLocationWithinWorld } from "../core/world_bounds.js";

export function setGauntletAnimation(boss, state) {
  if (!isEntityUsable(boss)) return;
  attempt(() => {
    if (boss.getProperty("bomd:animation_state") !== state) {
      boss.setProperty("bomd:animation_state", state);
    }
  }, "set Nether Gauntlet animation");
}

export function setGauntletVisual(boss, state) {
  if (!isEntityUsable(boss)) return;
  attempt(() => {
    if (boss.getProperty("bomd:visual_state") !== state) {
      boss.setProperty("bomd:visual_state", state);
    }
  }, "set Nether Gauntlet visual state");
}

export function setGauntletEyeOpen(boss, isOpen) {
  if (!isEntityUsable(boss)) return;
  attempt(
    () => boss.triggerEvent(isOpen ? "bomd:open_hand" : "bomd:close_fist"),
    "synchronize Nether Gauntlet physical collision"
  );
  attempt(() => {
    if (boss.getProperty(GAUNTLET_EYE_OPEN_PROPERTY) !== isOpen) {
      boss.setProperty(GAUNTLET_EYE_OPEN_PROPERTY, isOpen);
    }
  }, "set Nether Gauntlet eye vulnerability");
}

export function resetGauntletVisuals(boss, eyeOpen = true) {
  setGauntletAnimation(boss, GAUNTLET_ANIMATION_STATE.idle);
  setGauntletVisual(boss, GAUNTLET_VISUAL_STATE.normal);
  setGauntletEyeOpen(boss, eyeOpen);
}

export function spawnGauntletParticle(dimension, particleId, location) {
  if (!isLocationWithinWorld(dimension, location, 0.01) || !isLocationLoaded(dimension, location, 0.01)) return;
  attempt(
    () => dimension.spawnParticle(particleId, location),
    `spawn ${particleId}`
  );
}

export function spawnGauntletBurst(
  dimension,
  center,
  count = 20,
  radius = 1.5,
  particleId = GAUNTLET_SPARK_PARTICLE
) {
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count;
    const layer = ((index % 5) - 2) * 0.16;
    spawnGauntletParticle(dimension, particleId, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + 0.8 + layer,
      z: center.z + Math.sin(angle) * radius
    });
  }
}

export function spawnGauntletRing(
  dimension,
  center,
  radius,
  particleId,
  density = 5
) {
  const count = Math.max(18, Math.ceil(radius * density));
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count;
    spawnGauntletParticle(dimension, particleId, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + 0.15,
      z: center.z + Math.sin(angle) * radius
    });
  }
}

export function playGauntletSound(
  dimension,
  soundId,
  location,
  volume = 1,
  pitch = 1
) {
  const safeLocation = clampEntityLocation(dimension, location);
  if (!isLocationLoaded(dimension, safeLocation, 0.01)) return;
  attempt(
    () => dimension.playSound(soundId, safeLocation, { volume, pitch }),
    `play ${soundId}`
  );
}

export function warnGauntletPlayers(boss, text, radius = 48) {
  if (!isEntityUsable(boss)) return;
  const players = attempt(
    () => boss.dimension.getPlayers({ location: boss.location, maxDistance: radius }),
    "query Nether Gauntlet players"
  ) ?? [];
  for (const player of players) {
    attempt(
      () => player.onScreenDisplay.setActionBar(text),
      "show Nether Gauntlet warning"
    );
  }
}
