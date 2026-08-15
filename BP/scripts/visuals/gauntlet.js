// @ts-check

import {
  GAUNTLET_IMPACT_PARTICLE,
  GAUNTLET_LASER_BEAM_TYPE,
  GAUNTLET_LASER_PARTICLE,
  GAUNTLET_LASER_TELEGRAPH_PARTICLE,
  GAUNTLET_WAVE_PARTICLE
} from "../core/config.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import { add, distance, scale } from "../core/vector.js";
import { spawnParticle } from "./frost.js";
import { world } from "@minecraft/server";

export function gauntletEyeOrigin(boss) {
  const view = boss.getViewDirection();
  return {
    x: boss.location.x + view.x * 0.72,
    y: boss.location.y + 1.62,
    z: boss.location.z + view.z * 0.72
  };
}

export function gauntletGroundPoint(dimension, location) {
  const block = attempt(
    () =>
      dimension.getBlockBelow(
        {
          x: location.x,
          y: location.y + 1,
          z: location.z
        },
        { maxDistance: 12 }
      ),
    "find Nether Gauntlet impact floor"
  );
  if (!block) {
    return {
      x: location.x,
      y: location.y,
      z: location.z
    };
  }
  return {
    x: block.location.x + 0.5,
    y: block.location.y + 1.04,
    z: block.location.z + 0.5
  };
}

export function gauntletBeamDistance(
  dimension,
  origin,
  direction,
  maximumDistance = 30
) {
  return gauntletBeamTrace(
    dimension,
    origin,
    direction,
    maximumDistance
  ).distance;
}

export function gauntletBeamTrace(
  dimension,
  origin,
  direction,
  maximumDistance = 30
) {
  const hit = attempt(
    () =>
      dimension.getBlockFromRay(origin, direction, {
        maxDistance: maximumDistance,
        includeLiquidBlocks: false,
        includePassableBlocks: false
      }),
    "raycast Nether Gauntlet laser"
  );
  if (!hit) {
    return { distance: maximumDistance, hit: undefined };
  }
  const hitPoint = {
    x: hit.block.location.x + hit.faceLocation.x,
    y: hit.block.location.y + hit.faceLocation.y,
    z: hit.block.location.z + hit.faceLocation.z
  };
  return {
    distance: Math.max(
      0.25,
      Math.min(maximumDistance, distance(origin, hitPoint))
    ),
    hit
  };
}

export function updateGauntletBeamEntity(
  boss,
  data,
  origin,
  direction,
  beamDistance,
  active
) {
  let beam = data.beamEntityId
    ? attempt(
        () => world.getEntity(data.beamEntityId),
        "resolve Nether Gauntlet beam entity"
      )
    : undefined;
  if (!isEntityUsable(beam)) {
    beam = attempt(
      () => boss.dimension.spawnEntity(GAUNTLET_LASER_BEAM_TYPE, origin),
      "spawn Nether Gauntlet beam entity"
    );
    if (!isEntityUsable(beam)) {
      return;
    }
    data.beamEntityId = beam.id;
  }
  const end = add(origin, scale(direction, beamDistance));
  attempt(
    () => beam.setProperty("bomd:beam_length", beamDistance),
    "size Nether Gauntlet beam entity"
  );
  attempt(
    () => beam.setProperty("bomd:beam_active", active),
    "style Nether Gauntlet beam entity"
  );
  attempt(
    () => beam.teleport(origin, { facingLocation: end }),
    "aim Nether Gauntlet beam entity"
  );
}

export function removeGauntletBeamEntity(data) {
  if (!data?.beamEntityId) {
    return;
  }
  const beam = attempt(
    () => world.getEntity(data.beamEntityId),
    "resolve stale Nether Gauntlet beam entity"
  );
  if (isEntityUsable(beam)) {
    attempt(() => beam.remove(), "remove Nether Gauntlet beam entity");
  }
  data.beamEntityId = undefined;
}

export function spawnGauntletBeam(
  dimension,
  origin,
  direction,
  beamDistance,
  telegraph = false
) {
  const particle = telegraph
    ? GAUNTLET_LASER_TELEGRAPH_PARTICLE
    : GAUNTLET_LASER_PARTICLE;
  const step = telegraph ? 1.5 : 1;
  for (let length = 0.5; length <= beamDistance; length += step) {
    spawnParticle(
      dimension,
      particle,
      add(origin, scale(direction, length))
    );
  }
}

export function spawnGauntletRing(
  dimension,
  center,
  radius,
  count = 36
) {
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count;
    spawnParticle(dimension, GAUNTLET_WAVE_PARTICLE, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + 0.08,
      z: center.z + Math.sin(angle) * radius
    });
  }
}

export function spawnGauntletImpact(dimension, center, count = 28) {
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count;
    const radius = 0.35 + (index % 5) * 0.18;
    spawnParticle(dimension, GAUNTLET_IMPACT_PARTICLE, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + 0.15 + (index % 4) * 0.16,
      z: center.z + Math.sin(angle) * radius
    });
  }
}
