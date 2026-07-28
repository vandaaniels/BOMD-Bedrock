// @ts-check

import { EntityDamageCause } from "@minecraft/server";
import {
  GAUNTLET_ATTACK_TICKS,
  GAUNTLET_DAMAGE,
  GAUNTLET_LASER_LAG_TICKS,
  GAUNTLET_LASER_PARTICLE,
  GAUNTLET_SPARK_PARTICLE,
  GAUNTLET_TELEGRAPH_PARTICLE,
} from "../../core/gauntlet_config.js";
import { destroyBossBlock } from "../../core/controlled_destruction.js";
import { debugEnabled, debugLine, debugPoint, recordCombatEvent } from "../../core/combat_debug.js";
import { scaleBossDamage } from "../../core/difficulty.js";
import { attempt } from "../../core/safe.js";
import { maxRayDistanceInsideWorld } from "../../core/world_bounds.js";
import { add, distance, normalize, scale, subtract } from "../../core/vector.js";
import { playGauntletSound, spawnGauntletBurst, spawnGauntletParticle } from "../../visuals/nether_gauntlet.js";
import { gauntletContextActive, gauntletEyeOrigin } from "./shared.js";

const RANGE = 30;
const SPACING = 0.72;

function targetCenter(target) {
  return { x: target.location.x, y: target.location.y + 0.9, z: target.location.z };
}

function beamTrace(boss, origin, direction) {
  const safeRange = maxRayDistanceInsideWorld(boss.dimension, origin, direction, RANGE);
  if (safeRange <= 0.01) return { end: origin, length: 0, hit: undefined };
  const hit = attempt(
    () => boss.dimension.getBlockFromRay(origin, direction, {
      maxDistance: safeRange,
      includeLiquidBlocks: false,
      includePassableBlocks: false
    }),
    "raycast Gauntlet laser"
  );
  if (!hit?.block?.location) {
    return { end: add(origin, scale(direction, safeRange)), length: safeRange, hit: undefined };
  }
  const face = hit.faceLocation ?? { x: 0.5, y: 0.5, z: 0.5 };
  const end = {
    x: hit.block.location.x + face.x,
    y: hit.block.location.y + face.y,
    z: hit.block.location.z + face.z
  };
  return { end, length: Math.min(safeRange, distance(origin, end)), hit };
}

function distanceToSegment(point, start, direction, length) {
  const relative = subtract(point, start);
  const projection = Math.max(0, Math.min(length,
    relative.x * direction.x + relative.y * direction.y + relative.z * direction.z));
  const closest = add(start, scale(direction, projection));
  return distance(point, closest);
}

function renderBeam(context, targetPoint, damaging, tick) {
  if (!gauntletContextActive(context, false)) return;
  const { boss } = context;
  const origin = gauntletEyeOrigin(boss);
  const direction = normalize(subtract(targetPoint, origin));
  const trace = beamTrace(boss, origin, direction);

  if (debugEnabled("laser")) {
    debugLine(
      boss.dimension,
      origin,
      trace.end,
      damaging ? "minecraft:basic_flame_particle" : "minecraft:basic_portal_particle",
      0.35
    );
    for (const historical of context.attackData.history ?? []) {
      debugPoint(boss.dimension, historical, "minecraft:basic_smoke_particle");
    }
  }

  for (let step = 0.35; step <= trace.length; step += SPACING) {
    spawnGauntletParticle(
      boss.dimension,
      damaging ? GAUNTLET_LASER_PARTICLE : GAUNTLET_TELEGRAPH_PARTICLE,
      add(origin, scale(direction, step))
    );
  }

  if (!damaging) return;
  if (tick % 5 === 0) {
    recordCombatEvent("gauntlet_laser_sample", {
      bossId: boss.id,
      tick,
      origin,
      end: trace.end,
      length: trace.length,
      targetPoint
    });
  }
  const damage = scaleBossDamage(GAUNTLET_DAMAGE.laser);
  const players = attempt(
    () => boss.dimension.getPlayers({ location: origin, maxDistance: RANGE + 3 }),
    "query Gauntlet laser players"
  ) ?? [];
  for (const player of players) {
    if (distanceToSegment(targetCenter(player), origin, direction, trace.length) > 1.0) continue;
    // Java attempts a melee attack every active tick. Bedrock's own hurt
    // immunity decides whether a repeated tick applies, rather than a custom
    // ten-tick timer that can desynchronise from armor and effects.
    if (damage > 0) {
      attempt(() => player.applyDamage(damage, {
        damagingEntity: boss,
        cause: EntityDamageCause.entityAttack
      }), "Gauntlet laser Java-frequency damage");
    }
  }

  // Java erodes a tiny box at the beam impact every second tick. One protected,
  // controlled block is removed at a time so the beam drills through walls
  // without destroying arena cores, containers, rewards or unbreakable blocks.
  if (trace.hit?.block && tick % 2 === 0) {
    destroyBossBlock(boss.dimension, trace.hit.block.location, "laser");
  }
}

function recordTarget(context) {
  const { target, attackData } = context;
  if (!target?.isValid) return;
  attackData.history.push(targetCenter(target));
  if (attackData.history.length > GAUNTLET_LASER_LAG_TICKS) attackData.history.shift();
}

export const laser = {
  id: "laser",
  duration: 120,
  execute(context) {
    const { attackData } = context;
    if (!gauntletContextActive(context)) return;
    attackData.history = [];
    attackData.stage = "charging";
  },
  pulse(context, pulse) {
    if (!gauntletContextActive(context, false)) return;
    const { boss, attackData } = context;
    if (pulse === "begin") {
      attackData.stage = "charging";
      playGauntletSound(boss.dimension, "bomd.nether_gauntlet.laser_charge", boss.location, 1.6, 1.0);
    } else if (pulse === "active") {
      attackData.history = [];
      attackData.stage = "active";
    } else if (pulse === "recovery") {
      attackData.stage = "recovery";
    }
  },
  tick(context, localTick) {
    const { boss, attackData } = context;
    if (!gauntletContextActive(context)) return;
    if (attackData.stage === "charging") {
      renderBeam(context, targetCenter(context.target), false, localTick);
      if (localTick % 3 === 0) {
        spawnGauntletBurst(boss.dimension, gauntletEyeOrigin(boss), 8, 0.35, GAUNTLET_SPARK_PARTICLE);
      }
      return;
    }
    if (attackData.stage !== "active") return;
    recordTarget(context);
    if (attackData.history.length < GAUNTLET_LASER_LAG_TICKS) {
      renderBeam(context, targetCenter(context.target), false, localTick);
      return;
    }
    renderBeam(context, attackData.history[0], true, localTick);
  }
};
