// @ts-check

import {
  ANIMATION_TICKS,
  ANIMATION_STATE,
  LEASH_RADIUS,
  TELEPORT_PARTICLE
} from "../core/config.js";
import { attempt, isEntityUsable, schedule } from "../core/safe.js";
import {
  distance,
  horizontalDistance,
  normalize,
  subtract
} from "../core/vector.js";
import {
  playSound,
  setAnimationState,
  spawnBurst
} from "../visuals/frost.js";
import { contextActive } from "./shared.js";

function hasClearRay(dimension, location, target) {
  const endpoint = target.getHeadLocation();
  const delta = subtract(endpoint, location);
  const range = distance(location, endpoint);
  if (range <= 1) {
    return true;
  }
  const hit = attempt(
    () =>
      dimension.getBlockFromRay(location, normalize(delta), {
        maxDistance: Math.max(0.1, range - 0.75),
        includeLiquidBlocks: false,
        includePassableBlocks: false
      }),
    "validate lich teleport sightline"
  );
  return !hit;
}

function hasFullLichSpace(dimension, location) {
  const halfWidth = 0.9;
  const minX = Math.floor(location.x - halfWidth);
  const maxX = Math.floor(location.x + halfWidth);
  const minZ = Math.floor(location.z - halfWidth);
  const maxZ = Math.floor(location.z + halfWidth);
  const minY = Math.floor(location.y);
  const maxY = Math.floor(location.y + 2.999);

  try {
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          if (!dimension.getBlock({ x, y, z })?.isAir) {
            return false;
          }
        }
      }
    }
  } catch {
    return false;
  }
  return true;
}

function tryRangedTeleport(context, requireSightline) {
  const { boss, target, home } = context;
  for (let index = 0; index < 28; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 20 + Math.random() * 15;
    const candidate = {
      x: target.location.x + Math.cos(angle) * radius,
      y: target.location.y + 4 + Math.random() * 4,
      z: target.location.z + Math.sin(angle) * radius
    };
    if (
      horizontalDistance(candidate, home) > LEASH_RADIUS - 2 ||
      !hasFullLichSpace(boss.dimension, candidate) ||
      (requireSightline &&
        !hasClearRay(boss.dimension, candidate, target))
    ) {
      continue;
    }

    const teleported = attempt(
      () =>
        boss.tryTeleport(candidate, {
          checkForBlocks: true,
          facingLocation: target.location
        }),
      "try lich teleport"
    );
    if (teleported) {
      return true;
    }
  }
  return false;
}

function findDestination(context) {
  const { boss, target, home } = context;
  if (
    tryRangedTeleport(context, true) ||
    tryRangedTeleport(context, false)
  ) {
    return true;
  }
  attempt(
    () =>
      boss.teleport(home, { facingLocation: target.location }),
    "fallback lich teleport"
  );
  return false;
}

export const teleport = {
  id: "teleport",
  duration: 80,
  execute(context) {
    const { boss, target } = context;
    if (!contextActive(context)) {
      return;
    }

    setAnimationState(boss, ANIMATION_STATE.teleport);
    const origin = { ...boss.location };

    schedule(
      10,
      () => {
        if (contextActive(context)) {
          boss.triggerEvent("bomd:begin_teleport");
          playSound(
            boss.dimension,
            "bomd.night_lich.teleport_prepare",
            origin,
            3,
            1
          );
        }
      },
      "teleport preparation sound"
    );

    for (let tick = 15; tick <= 24; tick += 1) {
      schedule(
        tick,
        () => {
          if (contextActive(context)) {
            spawnBurst(
              boss.dimension,
              origin,
              14,
              0.7 + (tick - 15) * 0.08,
              TELEPORT_PARTICLE
            );
          }
        },
        "teleport telegraph"
      );
    }

    schedule(
      ANIMATION_TICKS.teleportVanish,
      () => {
        if (contextActive(context, false)) {
          setAnimationState(boss, ANIMATION_STATE.teleporting);
        }
      },
      "teleport vanish"
    );
    schedule(
      ANIMATION_TICKS.teleportMove,
      () => {
        if (isEntityUsable(boss)) {
          boss.triggerEvent("bomd:end_teleport");
        }
        if (!contextActive(context)) {
          return;
        }
        findDestination(context);
        setAnimationState(boss, ANIMATION_STATE.unteleport);
        spawnBurst(
          boss.dimension,
          boss.location,
          28,
          1.6,
          TELEPORT_PARTICLE
        );
        playSound(
          boss.dimension,
          "mob.endermen.portal",
          boss.location,
          2,
          0.85
        );
      },
      "lich teleport"
    );
    schedule(
      ANIMATION_TICKS.teleportReturn,
      () => {
        if (contextActive(context, false)) {
          setAnimationState(boss, ANIMATION_STATE.idle);
        }
      },
      "teleport animation follow-through"
    );
  }
};
