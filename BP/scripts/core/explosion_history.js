// @ts-check

import { system, world } from "@minecraft/server";
import { attempt, isEntityUsable } from "./safe.js";
import { distance } from "./vector.js";

const HISTORY_TICKS = 6;
const records = [];
let started = false;

function impactedCenter(event) {
  const blocks = attempt(() => event.getImpactedBlocks(), "read explosion impacted blocks") ?? [];
  if (blocks.length === 0) return undefined;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const block of blocks) {
    const location = block.location;
    minX = Math.min(minX, location.x);
    minY = Math.min(minY, location.y);
    minZ = Math.min(minZ, location.z);
    maxX = Math.max(maxX, location.x + 1);
    maxY = Math.max(maxY, location.y + 1);
    maxZ = Math.max(maxZ, location.z + 1);
  }
  return { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5, z: (minZ + maxZ) * 0.5 };
}

function recordExplosion(event) {
  const source = event.source;
  const sourceLocation = isEntityUsable(source) ? { ...source.location } : undefined;
  const location = sourceLocation ?? impactedCenter(event);
  if (!location) return;
  const record = {
    dimensionId: event.dimension.id,
    location,
    sourceId: isEntityUsable(source) ? source.id : undefined,
    tick: system.currentTick
  };
  const duplicate = records.find((entry) =>
    entry.dimensionId === record.dimensionId &&
    entry.tick === record.tick &&
    entry.sourceId === record.sourceId &&
    distance(entry.location, record.location) < 0.75
  );
  if (!duplicate) records.push(record);
  prune(system.currentTick);
}

function prune(now) {
  while (records.length > 0 && now - records[0].tick > HISTORY_TICKS) records.shift();
}

export function recentExplosionOrigin(dimension, near, now, sourceId, maxDistance = 24) {
  prune(now);
  let best;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const record of records) {
    if (record.dimensionId !== dimension.id || now - record.tick > HISTORY_TICKS) continue;
    const separation = distance(record.location, near);
    if (separation > maxDistance) continue;
    if (sourceId && record.sourceId && sourceId !== record.sourceId) continue;
    const sourcePenalty = sourceId && !record.sourceId ? 8 : 0;
    const agePenalty = (now - record.tick) * 2;
    const score = separation + agePenalty + sourcePenalty;
    if (score < bestScore) {
      best = record.location;
      bestScore = score;
    }
  }
  return best ? { ...best } : undefined;
}

export function startExplosionHistory() {
  if (started) return;
  started = true;
  attempt(() => world.beforeEvents.explosion.subscribe(recordExplosion), "register explosion history before-event");
  attempt(() => world.afterEvents.explosion.subscribe(recordExplosion), "register explosion history after-event");
}
