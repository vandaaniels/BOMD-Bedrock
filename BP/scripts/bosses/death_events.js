// @ts-check

import { system, world } from "@minecraft/server";
import { BOSS_TYPE } from "../core/config.js";
import { GAUNTLET_TYPE } from "../core/gauntlet_config.js";
import { attempt } from "../core/safe.js";
import {
  beginGauntletDeathSequence,
  beginNightLichDeathSequence
} from "./death_sequences.js";

const BOSS_TYPES = new Set([BOSS_TYPE, GAUNTLET_TYPE]);
/** @type {Map<string, {id:string,typeId:string,dimension:any,location:{x:number,y:number,z:number},tick:number}>} */
const snapshots = new Map();
const startedDeaths = new Set();
let registered = false;

function identity(entity) {
  try {
    return { id: entity.id, typeId: entity.typeId };
  } catch {
    return undefined;
  }
}

export function rememberBossSnapshot(entity) {
  const currentIdentity = identity(entity);
  if (!currentIdentity || !BOSS_TYPES.has(currentIdentity.typeId)) return undefined;
  try {
    const snapshot = {
      id: currentIdentity.id,
      typeId: currentIdentity.typeId,
      dimension: entity.dimension,
      location: { ...entity.location },
      tick: system.currentTick
    };
    snapshots.set(snapshot.id, snapshot);
    return snapshot;
  } catch {
    return snapshots.get(currentIdentity.id);
  }
}

function beginSnapshot(snapshot, source) {
  if (!snapshot || startedDeaths.has(snapshot.id)) return false;
  startedDeaths.add(snapshot.id);
  snapshots.set(snapshot.id, snapshot);

  const started = attempt(() => {
    if (snapshot.typeId === GAUNTLET_TYPE) {
      beginGauntletDeathSequence(snapshot.dimension, snapshot.location);
    } else if (snapshot.typeId === BOSS_TYPE) {
      beginNightLichDeathSequence(snapshot.dimension, snapshot.location);
    } else {
      return false;
    }
    console.warn(`[BOMD] ${snapshot.typeId} death sequence started from ${source}.`);
    return true;
  }, `start ${snapshot.typeId} death sequence from ${source}`) === true;

  if (!started) startedDeaths.delete(snapshot.id);
  system.runTimeout(() => {
    snapshots.delete(snapshot.id);
    startedDeaths.delete(snapshot.id);
  }, 1200);
  return started;
}

export function beginRememberedBossDeath(entity, source = "boss manager") {
  const snapshot = rememberBossSnapshot(entity);
  return beginSnapshot(snapshot, source);
}

function beginByDeadEntity(deadEntity, source) {
  const currentIdentity = identity(deadEntity);
  if (!currentIdentity || !BOSS_TYPES.has(currentIdentity.typeId)) return false;
  const snapshot = rememberBossSnapshot(deadEntity) ?? snapshots.get(currentIdentity.id);
  if (!snapshot) {
    console.warn(`[BOMD] Missing death snapshot for ${currentIdentity.typeId} (${currentIdentity.id}); reward sequence could not start.`);
    return false;
  }
  return beginSnapshot(snapshot, source);
}

export function registerBossDeathEvents() {
  if (registered) return;
  registered = true;

  // Health change normally fires while the entity is still readable. Capture
  // primitive position data and the Dimension reference before removal.
  world.afterEvents.entityHealthChanged.subscribe((event) => {
    if (event.newValue > 0) return;
    beginByDeadEntity(event.entity, "entityHealthChanged");
  });

  // Some kill paths remove an entity before EntityDieAfterEvent exposes a
  // usable location. The before-remove snapshot is read-only and schedules
  // the actual reward work back into normal execution.
  world.beforeEvents.entityRemove.subscribe((event) => {
    const removed = event.removedEntity;
    const currentIdentity = identity(removed);
    if (!currentIdentity || !BOSS_TYPES.has(currentIdentity.typeId)) return;
    const snapshot = rememberBossSnapshot(removed);
    const health = attempt(
      () => removed.getComponent("minecraft:health"),
      "read removing boss health"
    );
    if (!snapshot || !health || health.currentValue > 0) return;
    system.run(() => beginSnapshot(snapshot, "entityRemoveBeforeEvent"));
  });

  // Final fallback. It deliberately does not read dimension/location from the
  // now-dead object; Bedrock may already have invalidated those properties.
  world.afterEvents.entityDie.subscribe((event) => {
    beginByDeadEntity(event.deadEntity, "entityDie");
  });

  system.runInterval(() => {
    const cutoff = system.currentTick - 1200;
    for (const [id, snapshot] of snapshots) {
      if (!startedDeaths.has(id) && snapshot.tick < cutoff) snapshots.delete(id);
    }
  }, 600);
}
