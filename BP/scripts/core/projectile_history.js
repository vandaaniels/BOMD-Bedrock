// @ts-check

import { system, world } from "@minecraft/server";
import { attempt, isEntityUsable } from "./safe.js";

const tracked = new Map();
let started = false;

function isProjectile(entity) {
  return Boolean(
    attempt(
      () => entity.getComponent("minecraft:projectile"),
      "inspect projectile component"
    )
  );
}

function remember(entity) {
  if (!isEntityUsable(entity) || !isProjectile(entity)) return;
  tracked.set(entity.id, {
    entity,
    previousLocation: { ...entity.location },
    currentLocation: { ...entity.location },
    previousVelocity: attempt(() => entity.getVelocity(), "read projectile velocity") ?? {
      x: 0,
      y: 0,
      z: 0
    },
    spawnTick: system.currentTick
  });
}

function tick() {
  for (const [id, entry] of tracked) {
    if (!isEntityUsable(entry.entity)) {
      tracked.delete(id);
      continue;
    }
    entry.previousLocation = entry.currentLocation;
    entry.currentLocation = { ...entry.entity.location };
    entry.previousVelocity =
      attempt(() => entry.entity.getVelocity(), "update projectile velocity") ??
      entry.previousVelocity;
  }
}

export function projectileSegment(projectile) {
  const entry = tracked.get(projectile?.id);
  if (!entry) return undefined;
  return {
    previousLocation: { ...entry.previousLocation },
    currentLocation: { ...entry.currentLocation },
    previousVelocity: { ...entry.previousVelocity },
    spawnTick: entry.spawnTick
  };
}

export function startProjectileHistory() {
  if (started) return;
  started = true;
  world.afterEvents.entitySpawn.subscribe((event) => remember(event.entity));
  system.runInterval(tick, 1);
}
