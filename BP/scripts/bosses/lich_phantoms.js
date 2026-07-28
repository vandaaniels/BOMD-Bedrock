// @ts-check

import { EntityDamageCause, GameMode, system, world } from "@minecraft/server";
import {
  BOSS_TYPE,
  COMBAT_RADIUS,
  LICH_PHANTOM_TYPE,
  MINION_TAG
} from "../core/config.js";
import { debugEnabled, debugLine, recordBossSample, recordCombatEvent } from "../core/combat_debug.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import { isLocationLoaded } from "../core/world_bounds.js";
import { add, distance, normalize, scale, subtract } from "../core/vector.js";

const PARENT_PROPERTY = "bomd:parent_boss_id";
const TARGET_PROPERTY = "bomd:target_player_id";
const tracked = new Map();
let registered = false;
let lastDiscoveryTick = -Infinity;

function validPlayer(player, dimension) {
  if (!isEntityUsable(player) || player.dimension.id !== dimension.id) return false;
  const mode = player.getGameMode();
  return mode === GameMode.Survival || mode === GameMode.Adventure;
}

function readString(entity, key) {
  const value = attempt(() => entity.getDynamicProperty(key), `read ${key}`);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function findEntityById(dimension, id, type) {
  if (!id) return undefined;
  return attempt(
    () => dimension.getEntities({ type }).find((entity) => entity.id === id),
    `find ${type} ${id}`
  );
}

function nearestPlayer(entity) {
  return entity.dimension
    .getPlayers({ location: entity.location, maxDistance: COMBAT_RADIUS })
    .filter((player) => validPlayer(player, entity.dimension))
    .sort((a, b) => distance(a.location, entity.location) - distance(b.location, entity.location))[0];
}

function initialize(phantom, now) {
  const state = {
    parentId: readString(phantom, PARENT_PROPERTY),
    targetId: readString(phantom, TARGET_PROPERTY),
    mode: "orbit",
    angle: Math.random() * Math.PI * 2,
    radius: 7 + Math.random() * 3,
    height: 6 + Math.random() * 4,
    nextDiveTick: now + 50 + Math.floor(Math.random() * 51),
    diveEndTick: 0,
    recoveryEndTick: 0,
    hitThisDive: false,
    previousLocation: { ...phantom.location }
  };
  phantom.addTag(MINION_TAG);
  tracked.set(phantom.id, { phantom, state });
  return state;
}

function steerToward(entity, destination, speed, mass) {
  const currentVelocity = attempt(() => entity.getVelocity(), "read Lich phantom velocity") ?? { x: 0, y: 0, z: 0 };
  const direction = normalize(subtract(destination, entity.location));
  const desired = scale(direction, speed);
  const impulse = {
    x: (desired.x - currentVelocity.x) / mass,
    y: (desired.y - currentVelocity.y) / mass,
    z: (desired.z - currentVelocity.z) / mass
  };
  attempt(() => entity.applyImpulse(impulse), "steer Lich phantom");
  const velocity = add(currentVelocity, impulse);
  if (Math.abs(velocity.x) + Math.abs(velocity.y) + Math.abs(velocity.z) > 0.02) {
    attempt(
      () => entity.lookAt(add(entity.location, velocity)),
      "orient Lich phantom"
    );
  }
  return direction;
}

function startDive(state, now, phantom, target) {
  state.mode = "dive";
  state.diveEndTick = now + 40;
  state.hitThisDive = false;
  recordCombatEvent("lich_phantom_dive", {
    phantomId: phantom.id,
    targetId: target.id,
    location: phantom.location
  });
}

function endDive(state, now) {
  state.mode = "recover";
  state.recoveryEndTick = now + 20;
  state.radius = 7 + Math.random() * 3;
  state.height = 6 + Math.random() * 4;
  state.nextDiveTick = now + 55 + Math.floor(Math.random() * 66);
  state.hitThisDive = false;
}

function updatePhantom(phantom, state, now) {
  if (!isEntityUsable(phantom)) return false;
  if (!isLocationLoaded(phantom.dimension, phantom.location)) return true;

  const parent = findEntityById(phantom.dimension, state.parentId, BOSS_TYPE);
  if (!isEntityUsable(parent)) {
    attempt(() => phantom.remove(), "remove orphaned Lich phantom");
    return false;
  }

  let target = phantom.dimension
    .getPlayers()
    .find((player) => player.id === state.targetId && validPlayer(player, phantom.dimension));
  target ??= nearestPlayer(phantom);
  if (!target) {
    const destination = {
      x: parent.location.x + Math.cos(state.angle) * 5,
      y: parent.location.y + 4,
      z: parent.location.z + Math.sin(state.angle) * 5
    };
    state.angle += 0.035;
    steerToward(phantom, destination, 0.72, 16);
    return true;
  }
  state.targetId = target.id;
  attempt(() => phantom.setDynamicProperty(TARGET_PROPERTY, target.id), "persist Lich phantom target");

  let desired;
  if (state.mode === "dive") {
    desired = {
      x: target.location.x,
      y: target.location.y + 0.85,
      z: target.location.z
    };
    const direction = steerToward(phantom, desired, 1.35, 7);
    if (debugEnabled("movement")) {
      debugLine(phantom.dimension, phantom.location, add(phantom.location, scale(direction, 4)), "minecraft:basic_flame_particle", 0.35);
    }
    if (!state.hitThisDive && distance(phantom.location, desired) <= 1.65) {
      state.hitThisDive = true;
      attempt(
        () => target.applyDamage(6, {
          cause: EntityDamageCause.entityAttack,
          damagingEntity: phantom
        }),
        "Lich phantom swoop damage"
      );
      const horizontal = normalize({
        x: target.location.x - phantom.location.x,
        y: 0,
        z: target.location.z - phantom.location.z
      });
      attempt(() => target.applyKnockback({ x: horizontal.x * 0.7, z: horizontal.z * 0.7 }, 0.18), "Lich phantom swoop knockback");
      recordCombatEvent("lich_phantom_hit", {
        phantomId: phantom.id,
        targetId: target.id,
        tick: now
      });
    }
    if (now >= state.diveEndTick || distance(phantom.location, target.location) > 34) {
      endDive(state, now);
    }
  } else if (state.mode === "recover") {
    const away = normalize(subtract(phantom.location, target.location));
    desired = {
      x: target.location.x + away.x * Math.max(4, state.radius * 0.65),
      y: target.location.y + state.height + 2,
      z: target.location.z + away.z * Math.max(4, state.radius * 0.65)
    };
    const direction = steerToward(phantom, desired, 1.05, 10);
    if (debugEnabled("movement")) {
      debugLine(phantom.dimension, phantom.location, add(phantom.location, scale(direction, 3)), "minecraft:basic_smoke_particle", 0.45);
    }
    if (now >= state.recoveryEndTick) state.mode = "orbit";
  } else {
    state.angle += 0.045;
    desired = {
      x: target.location.x + Math.cos(state.angle) * state.radius,
      y: target.location.y + state.height + Math.sin(state.angle * 0.55) * 1.5,
      z: target.location.z + Math.sin(state.angle) * state.radius
    };
    const direction = steerToward(phantom, desired, 0.88, 15);
    if (debugEnabled("movement")) {
      debugLine(phantom.dimension, phantom.location, add(phantom.location, scale(direction, 3)), "minecraft:basic_portal_particle", 0.45);
    }
    if (now >= state.nextDiveTick && distance(phantom.location, target.location) <= 30) {
      startDive(state, now, phantom, target);
    }
  }

  recordBossSample("lich_phantom", phantom, {
    parentId: state.parentId,
    targetId: state.targetId,
    mode: state.mode
  }, 10);
  state.previousLocation = { ...phantom.location };
  return true;
}

function discover(now) {
  lastDiscoveryTick = now;
  for (const dimensionId of ["overworld", "nether", "the_end"]) {
    const dimension = world.getDimension(dimensionId);
    for (const phantom of dimension.getEntities({ type: LICH_PHANTOM_TYPE })) {
      if (!tracked.has(phantom.id)) initialize(phantom, now);
    }
  }
}

function tick() {
  const now = system.currentTick;
  if (now - lastDiscoveryTick >= 40) discover(now);
  for (const [id, entry] of tracked) {
    if (!updatePhantom(entry.phantom, entry.state, now)) tracked.delete(id);
  }
}

export function configureLichPhantom(phantom, boss, target) {
  phantom.addTag(MINION_TAG);
  phantom.setDynamicProperty(PARENT_PROPERTY, boss.id);
  phantom.setDynamicProperty(TARGET_PROPERTY, target?.id);
  const state = initialize(phantom, system.currentTick);
  state.parentId = boss.id;
  state.targetId = target?.id;
}

export function startLichPhantomManager() {
  if (registered) return;
  registered = true;
  world.afterEvents.entitySpawn.subscribe((event) => {
    if (event.entity.typeId !== LICH_PHANTOM_TYPE) return;
    system.run(() => {
      if (isEntityUsable(event.entity) && !tracked.has(event.entity.id)) {
        initialize(event.entity, system.currentTick);
      }
    });
  });
  system.runInterval(tick, 1);
}
