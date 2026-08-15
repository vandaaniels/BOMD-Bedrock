// @ts-check

import { EntityDamageCause, system } from "@minecraft/server";
import { OBSIDILITH_DAMAGE } from "../../core/config.js";
import { isBossCombatPlayer } from "../../core/combat_target.js";
import { attempt, isEntityUsable } from "../../core/safe.js";
import { horizontalDistance } from "../../core/vector.js";
import { playSound, spawnParticle } from "../../visuals/frost.js";

export function groundAt(dimension, point) {
  const x = Math.floor(point.x);
  const z = Math.floor(point.z);
  const centerY = Math.floor(point.y);

  // Most attack targets are already close to the floor. Probe nearby levels
  // first instead of starting 14 blocks above every sampled column. This
  // dramatically reduces getBlock pressure during large Obsidilith attacks.
  const candidateYs = [];
  for (let y = centerY + 2; y >= centerY - 14; y -= 1) candidateYs.push(y);
  for (let y = centerY + 3; y <= centerY + 14; y += 1) candidateYs.push(y);

  for (const y of candidateYs) {
    const floor = attempt(
      () => dimension.getBlock({ x, y, z }),
      "find Obsidilith rift floor"
    );
    const open = attempt(
      () => dimension.getBlock({ x, y: y + 1, z }),
      "find Obsidilith rift clearance"
    );
    if (floor && open && !floor.isAir && !floor.isLiquid && open.isAir) {
      return {
        x: x + 0.5,
        y: y + 1,
        z: z + 0.5,
        blockX: x,
        blockY: y + 1,
        blockZ: z
      };
    }
  }
  return undefined;
}

// Java's buildBlockCircle is a filled block disc, despite its name.
function discOffsets(radius) {
  const offsets = [];
  const integerRadius = Math.floor(radius);
  const radiusSquared = radius * radius;
  for (let x = -integerRadius; x <= integerRadius; x += 1) {
    for (let z = -integerRadius; z <= integerRadius; z += 1) {
      if (x * x + z * z <= radiusSquared) offsets.push({ x, z });
    }
  }
  return offsets;
}

export function discGroundPoints(dimension, center, radius) {
  const points = new Map();
  for (const offset of discOffsets(radius)) {
    const ground = groundAt(dimension, {
      x: center.x + offset.x,
      y: center.y,
      z: center.z + offset.z
    });
    if (!ground) continue;
    points.set(`${ground.blockX},${ground.blockY},${ground.blockZ}`, ground);
  }
  return [...points.values()];
}

// Spread terrain probing across ticks. Large filled discs are expensive in
// Bedrock because each candidate may require several block reads.
export function scanDiscGroundPoints(dimension, center, radius, onComplete, columnsPerTick = 8) {
  const offsets = discOffsets(radius);
  const points = new Map();
  let cursor = 0;
  let elapsedTicks = 0;
  const budget = Math.max(1, Math.floor(columnsPerTick));
  const runId = system.runInterval(() => {
    elapsedTicks += 1;
    const end = Math.min(offsets.length, cursor + budget);
    for (; cursor < end; cursor += 1) {
      const offset = offsets[cursor];
      const ground = groundAt(dimension, {
        x: center.x + offset.x,
        y: center.y,
        z: center.z + offset.z
      });
      if (!ground) continue;
      points.set(`${ground.blockX},${ground.blockY},${ground.blockZ}`, ground);
    }
    if (cursor < offsets.length) return;
    system.clearRun(runId);
    onComplete([...points.values()], elapsedTicks);
  }, 1);
  return runId;
}

export function damagePlayersAt(boss, center, options = {}) {
  const radius = options.radius ?? 1.15;
  const verticalTolerance = options.verticalTolerance ?? 1.25;
  const amount = options.amount ?? OBSIDILITH_DAMAGE;
  const verticalVelocity = options.knockup;
  const hit = options.hit ?? new Set();
  const players = attempt(
    () => boss.dimension.getPlayers({ location: center, maxDistance: radius + 4 }),
    "query Obsidilith rift victims"
  ) ?? [];
  for (const player of players.filter(isBossCombatPlayer)) {
    if (hit.has(player.id)) continue;
    if (horizontalDistance(player.location, center) > radius) continue;
    if (Math.abs(player.location.y - center.y) > verticalTolerance) continue;
    applyRiftDamage(boss, player, options, amount, verticalVelocity, hit);
  }
}

function applyRiftDamage(boss, player, options, amount, verticalVelocity, hit) {
  hit.add(player.id);
  attempt(
    () => player.applyDamage(amount, {
      // Magic is used as Bedrock's shield-piercing equivalent.
      cause: EntityDamageCause.magic,
      damagingEntity: boss
    }),
    "damage player with Obsidilith rift"
  );
  if (typeof verticalVelocity === "number") {
    const velocity = attempt(
      () => player.getVelocity(),
      "read Obsidilith rift target velocity"
    ) ?? { x: 0, y: 0, z: 0 };
    attempt(
      () => player.applyImpulse({
        x: 0,
        y: verticalVelocity - velocity.y,
        z: 0
      }),
      "set Obsidilith rift vertical velocity"
    );
  }
  if (options.fireSeconds) {
    attempt(() => player.setOnFire(options.fireSeconds, true), "ignite Obsidilith wave target");
  }
  if (options.slownessTicks) {
    attempt(
      () => player.addEffect("slowness", options.slownessTicks, {
        amplifier: options.slownessAmplifier ?? 2,
        // Avoid spawning vanilla potion particles on top of an already dense
        // boss effect. The status itself is unchanged.
        showParticles: false
      }),
      "slow Obsidilith spike target"
    );
  }
}

function groupBounds(points, layer, radius) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    const y = point.y + layer * 2;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  const center = {
    x: (minX + maxX) * 0.5,
    y: (minY + maxY) * 0.5,
    z: (minZ + maxZ) * 0.5
  };
  const dx = (maxX - minX) * 0.5;
  const dy = (maxY - minY) * 0.5;
  const dz = (maxZ - minZ) * 0.5;
  return {
    center,
    maxDistance: Math.sqrt(dx * dx + dy * dy + dz * dz) + radius + 2
  };
}

// Damage for a whole layer is resolved with ONE player query instead of one
// query for every rift cell. Visual density is therefore independent from
// gameplay coverage and reducing effects never makes the attack safer.
function damageRiftLayer(boss, points, layer, options, hit) {
  if (!isEntityUsable(boss) || points.length === 0) return;
  const radius = options.radius ?? 1.15;
  const verticalTolerance = options.verticalTolerance ?? 1.25;
  const amount = options.amount ?? OBSIDILITH_DAMAGE;
  const verticalVelocity = options.knockup;
  const bounds = groupBounds(points, layer, radius);
  const players = attempt(
    () => boss.dimension.getPlayers({
      location: bounds.center,
      maxDistance: bounds.maxDistance
    }),
    "query Obsidilith rift group victims"
  ) ?? [];

  for (const player of players.filter(isBossCombatPlayer)) {
    if (hit.has(player.id)) continue;
    let inside = false;
    for (const point of points) {
      const layerPoint = { x: point.x, y: point.y + layer * 2, z: point.z };
      if (Math.abs(player.location.y - layerPoint.y) > verticalTolerance) continue;
      if (horizontalDistance(player.location, layerPoint) <= radius) {
        inside = true;
        break;
      }
    }
    if (inside) applyRiftDamage(boss, player, options, amount, verticalVelocity, hit);
  }
}

function selectVisualPoints(points, limit) {
  const max = Math.max(1, Math.floor(limit));
  if (points.length <= max) return points;
  const selected = [];
  const step = points.length / max;
  for (let index = 0; index < max; index += 1) {
    selected.push(points[Math.min(points.length - 1, Math.floor(index * step + step * 0.5))]);
  }
  return selected;
}

function spawnIndicatorsGradually(boss, points, particle, perTick) {
  if (!particle || points.length === 0) return;
  let cursor = 0;
  const budget = Math.max(1, Math.floor(perTick));
  const runId = system.runInterval(() => {
    if (!isEntityUsable(boss)) {
      system.clearRun(runId);
      return;
    }
    const end = Math.min(points.length, cursor + budget);
    for (; cursor < end; cursor += 1) {
      const point = points[cursor];
      spawnParticle(boss.dimension, particle, {
        x: point.x,
        y: point.y + 0.08,
        z: point.z
      });
    }
    if (cursor >= points.length) system.clearRun(runId);
  }, 1);
}

export function queueRiftGroup(boss, points, options) {
  if (!isEntityUsable(boss) || points.length === 0) return;

  const hit = new Set();
  const visualPoints = selectVisualPoints(points, options.maxVisualRifts ?? 24);
  spawnIndicatorsGradually(
    boss,
    visualPoints,
    options.indicatorParticle,
    options.indicatorsPerTick ?? 6
  );

  // Seven two-block layers preserve the vertical Java-style rift volume.
  // Only sampled visual points emit particles; ALL points still participate
  // in collision/damage through damageRiftLayer.
  for (let layer = 0; layer < 7; layer += 1) {
    system.runTimeout(() => {
      if (!isEntityUsable(boss)) return;
      for (const point of visualPoints) {
        spawnParticle(boss.dimension, options.columnParticle, {
          x: point.x,
          y: point.y + layer * 2,
          z: point.z
        });
      }
      damageRiftLayer(boss, points, layer, options.damage ?? {}, hit);
    }, options.delay + layer);
  }

  if (!options.impactSound) return;
  system.runTimeout(() => {
    if (isEntityUsable(boss)) {
      playSound(
        boss.dimension,
        options.impactSound,
        points[0] ?? boss.location,
        options.impactVolume ?? 1.2,
        options.impactPitch ?? (0.94 + Math.random() * 0.12)
      );
    }
  }, options.delay);
}
