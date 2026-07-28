// @ts-check

import { TELEPORT_PARTICLE } from "../core/config.js";
import {
  debugEnabled,
  debugPoint,
  recordCombatEvent
} from "../core/combat_debug.js";
import { lichInLineOfSight } from "../core/lich_visibility.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import {
  dimensionHeightRange,
  isLocationLoaded
} from "../core/world_bounds.js";
import { normalize } from "../core/vector.js";
import {
  playSound,
  spawnParticle,
  stopSoundInstance
} from "../visuals/frost.js";
import { contextActive } from "./shared.js";

const MIN_DISTANCE = 20;
const MAX_DISTANCE = 35;
const ATTEMPTS = 100;


function spawnTeleportParticle(boss) {
  if (!isEntityUsable(boss)) return;
  const center = boss.getHeadLocation();
  spawnParticle(boss.dimension, TELEPORT_PARTICLE, {
    x: center.x + (Math.random() * 2 - 1) * 3,
    y: center.y + (Math.random() * 2 - 1) * 3,
    z: center.z + (Math.random() * 2 - 1) * 3
  });
}

function randomDirection() {
  let result;
  do {
    result = {
      x: Math.random() * 2 - 1,
      y: Math.random() * 2 - 1,
      z: Math.random() * 2 - 1
    };
  } while (
    Math.abs(result.x) +
      Math.abs(result.y) +
      Math.abs(result.z) <
    0.001
  );
  return normalize(result);
}

function hasFullLichSpace(dimension, location) {
  if (!isLocationLoaded(dimension, location, 3.1)) return false;
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
          const block = dimension.getBlock({ x, y, z });
          if (!block?.isAir && !block?.isLiquid) return false;
        }
      }
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * Equivalent to MOTION_BLOCKING_NO_LEAVES for the loaded target column. The
 * prior implementation started only 32 blocks above the player and could miss
 * the actual surface when the arena had tall terrain above it.
 */
function topPositionNearTarget(target) {
  const dimension = target.dimension;
  const range = dimensionHeightRange(dimension);
  const x = Math.floor(target.location.x);
  const z = Math.floor(target.location.z);
  for (let y = range.max - 2; y >= range.min; y -= 1) {
    const block = attempt(
      () => dimension.getBlock({ x, y, z }),
      "find Night Lich teleport fallback height"
    );
    if (block && !block.isAir && !block.isLiquid) {
      return { x: x + 0.5, y: y + 1, z: z + 0.5 };
    }
  }
  return { ...target.location };
}

function candidateAround(center) {
  const radius =
    MIN_DISTANCE + Math.random() * (MAX_DISTANCE - MIN_DISTANCE);
  const direction = randomDirection();
  return {
    x: center.x + direction.x * radius,
    y: center.y + direction.y * radius,
    z: center.z + direction.z * radius
  };
}

function selectCandidate(context, center, phase) {
  const { boss, target } = context;
  for (let index = 0; index < ATTEMPTS; index += 1) {
    const candidate = candidateAround(center);
    if (debugEnabled("teleport")) {
      debugPoint(
        boss.dimension,
        candidate,
        "minecraft:basic_portal_particle"
      );
    }
    if (!hasFullLichSpace(boss.dimension, candidate)) continue;

    recordCombatEvent("lich_teleport_destination", {
      bossId: boss.id,
      targetId: target.id,
      candidate,
      phase,
      attempt: index + 1
    });
    return candidate;
  }
  return undefined;
}

/**
 * Java chooses and locks the destination when performTeleport starts, not at
 * tick 40. Its primary predicate checks the Lich's current visibility/facing
 * relationship with the target; it does not raycast from each candidate.
 */
function findDestination(context) {
  const { boss, target } = context;
  const primaryEligible = lichInLineOfSight(boss, target);
  if (primaryEligible) {
    const primary = selectCandidate(
      context,
      { ...target.location },
      "primary"
    );
    if (primary) {
      return { location: primary, phase: "primary", primaryEligible };
    }
  }

  const fallback = selectCandidate(
    context,
    topPositionNearTarget(target),
    "heightmap_fallback"
  );
  return fallback
    ? {
        location: fallback,
        phase: "heightmap_fallback",
        primaryEligible
      }
    : { location: undefined, phase: "failed", primaryEligible };
}

export const teleport = {
  id: "teleport",
  duration: 80,
  execute(context) {
    if (!contextActive(context)) return;
    context.attackData.targetId = context.target.id;
    context.attackData.destination = findDestination(context);
    context.attackData.prepareSound = undefined;
  },
  pulse(context, pulse) {
    const { boss, target, attackData } = context;
    if (!contextActive(context, false)) return;
    if (pulse === "prepare") {
      boss.triggerEvent("bomd:begin_teleport");
      attackData.prepareSound = playSound(
        boss.dimension,
        "bomd.night_lich.teleport_prepare",
        boss.location,
        3,
        1
      );
      return;
    }
    if (pulse === "particle") {
      spawnTeleportParticle(boss);
      return;
    }
    if (pulse === "vanish") {
      return;
    }
    if (pulse === "move") {
      stopSoundInstance(attackData.prepareSound, "stop Night Lich teleport preparation sound");
      const destination = attackData.destination ?? { location: undefined, phase: "failed", primaryEligible: false };
      let success = false;
      if (destination.location && isEntityUsable(boss)) {
        success = attempt(() => {
          const options = isEntityUsable(target) ? { facingLocation: target.location } : undefined;
          boss.teleport(destination.location, options);
          return true;
        }, "perform locked Night Lich teleport") === true;
      }
      if (isEntityUsable(boss)) boss.triggerEvent("bomd:end_teleport");
      if (!contextActive(context, false)) return;
      playSound(boss.dimension, "mob.endermen.portal", boss.location, 2, 0.85);
      recordCombatEvent(success ? "lich_teleport" : "lich_teleport_failed", {
        bossId: boss.id,
        targetId: attackData.targetId,
        destination: destination.location,
        phase: destination.phase,
        primaryEligible: destination.primaryEligible
      });
      return;
    }
    if (pulse === "complete") {
      stopSoundInstance(attackData.prepareSound, "finish Night Lich teleport preparation sound");
      if (isEntityUsable(boss)) boss.triggerEvent("bomd:end_teleport");
    }
  }
};
