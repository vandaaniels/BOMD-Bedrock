// @ts-check

import { GameMode, system, world } from "@minecraft/server";
import { comet } from "../attacks/comet.js";
import { magicMissileVolley } from "../attacks/magic_missile_volley.js";
import { rageComets } from "../attacks/rage_comets.js";
import { rageMinions } from "../attacks/rage_minions.js";
import { rageMissiles } from "../attacks/rage_missiles.js";
import { summonPhantoms } from "../attacks/summon_phantoms.js";
import { teleport } from "../attacks/teleport.js";
import {
  ANIMATION_STATE,
  ATTACK_HISTORY_PROPERTY,
  BOSS_TYPE,
  COMBAT_RADIUS,
  FROST_PARTICLE,
  HOME_X_PROPERTY,
  HOME_Y_PROPERTY,
  HOME_Z_PROPERTY,
  MANAGER_INTERVAL_TICKS,
  PHASE_RUNES_PARTICLE,
  PREVIOUS_ATTACK_PROPERTY,
  RAGE_QUEUE_PROPERTY,
  SOUL_FLAME_PARTICLE
} from "../core/config.js";
import {
  appendAttackHistory,
  cappedHealingLimit,
  calculateTeleportWeight,
  healthPhase,
  highestRememberedAttacker,
  regularAttackWeights,
  rememberDamage,
  shouldCappedHeal,
  UPSTREAM_IDLE_HEAL_PER_TICK
} from "../core/lich_logic.js";
import { bossRecoveryTicks, scaleDamageToBoss } from "../core/difficulty.js";
import { debugMovement, recordBossSample, recordCombatEvent } from "../core/combat_debug.js";
import { createMovementState, tickUpstreamFlight } from "../core/validated_flight.js";
import { setLichServerAttack, setLichTimelineHandler } from "../core/hybrid_timeline.js";
import {
  attempt,
  isEntityUsable,
  runSafely
} from "../core/safe.js";
import {
  distance,
  normalize,
  scale,
  subtract
} from "../core/vector.js";
import {
  hasDirectLichLineOfSight,
  lichInLineOfSight
} from "../core/lich_visibility.js";
import {
  playSound,
  setAnimationState,
  spawnBurst,
  spawnParticle
} from "../visuals/frost.js";
import { cleanupEncounterEntities } from "./encounter_cleanup.js";
import { beginRememberedBossDeath, rememberBossSnapshot } from "./death_events.js";

const stateByBossId = new Map();
const trackedBosses = new Map();
let lastDiscoveryTick = -999;
const RAGE_SEQUENCE = Object.freeze([
  rageComets,
  rageMissiles,
  rageMinions
]);
const RAGE_ATTACKS_BY_ID = new Map(
  RAGE_SEQUENCE.map((attack) => [attack.id, attack])
);
const BALANCE_VERSION = 6;
let started = false;

function readNumberProperty(entity, propertyId) {
  const value = entity.getDynamicProperty(propertyId);
  return typeof value === "number" ? value : undefined;
}

function readStringArrayProperty(entity, propertyId) {
  const value = entity.getDynamicProperty(propertyId);
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry) => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function writeStringArrayProperty(entity, propertyId, values) {
  entity.setDynamicProperty(
    propertyId,
    values.length > 0 ? JSON.stringify(values) : undefined
  );
}

function readHome(entity) {
  const x = readNumberProperty(entity, HOME_X_PROPERTY);
  const y = readNumberProperty(entity, HOME_Y_PROPERTY);
  const z = readNumberProperty(entity, HOME_Z_PROPERTY);

  if (x !== undefined && y !== undefined && z !== undefined) {
    return { x, y, z };
  }

  const home = { ...entity.location };
  entity.setDynamicProperty(HOME_X_PROPERTY, home.x);
  entity.setDynamicProperty(HOME_Y_PROPERTY, home.y);
  entity.setDynamicProperty(HOME_Z_PROPERTY, home.z);
  return home;
}

function nearbyPlayers(entity) {
  return entity.dimension
    .getPlayers({
      location: entity.location,
      maxDistance: COMBAT_RADIUS
    })
    .filter((player) => {
      const mode = player.getGameMode();
      return mode === GameMode.Survival || mode === GameMode.Adventure;
    });
}

function initializeBoss(boss, now) {
  const home = readHome(boss);
  const playerCount = 1;

  const health = boss.getComponent("minecraft:health");
  const calculatedPhase = health
    ? healthPhase(health.currentValue, health.effectiveMax)
    : 1;
  const storedPhase = boss.getProperty("bomd:phase");
  const phase =
    typeof storedPhase === "number"
      ? Math.max(1, Math.min(4, storedPhase))
      : calculatedPhase;

  const storedPrevious = boss.getDynamicProperty(
    PREVIOUS_ATTACK_PROPERTY
  );
  let attackHistory = readStringArrayProperty(
    boss,
    ATTACK_HISTORY_PROPERTY
  ).slice(-4);
  if (
    attackHistory.length === 0 &&
    typeof storedPrevious === "string" &&
    storedPrevious.length > 0
  ) {
    attackHistory = [storedPrevious];
  }

  const rageQueue = readStringArrayProperty(
    boss,
    RAGE_QUEUE_PROPERTY
  )
    .map((attackId) => RAGE_ATTACKS_BY_ID.get(attackId))
    .filter(Boolean);

  boss.nameTag = "Night Lich";
  boss.setProperty("bomd:phase", phase);
  boss.setProperty("bomd:head_yaw", 0);
  boss.setProperty("bomd:head_pitch", 0);
  boss.triggerEvent("bomd:end_teleport");
  setLichServerAttack(boss, "idle");
  setAnimationState(boss, ANIMATION_STATE.idle);

  const state = {
    home,
    movement: createMovementState(),
    attackHistory,
    currentAttack: /** @type {string | undefined} */ (undefined),
    attackData: {},
    attackContext: undefined,
    attackEndTick: now,
    nextAttackTick: now + 80,
    emptySinceTick: /** @type {number | undefined} */ (undefined),
    engaged: false,
    phase,
    rageQueue,
    castSerial: 0,
    strafeDirection: Math.random() < 0.5 ? -1 : 1,
    nextStrafeDecisionTick: now + 40 + Math.floor(Math.random() * 61),
    lastEyeGlowTick: now,
    lastIdleParticleTick: now,
    targetId: /** @type {string | undefined} */ (undefined),
    forcedTeleportTargetId:
      /** @type {string | undefined} */ (undefined),
    positionHistory: [{ ...boss.location }],
    damageMemory:
      /** @type {{ playerId: string, damage: number, tick: number }[]} */ (
        []
      )
  };

  stateByBossId.set(boss.id, state);
  trackedBosses.set(boss.id, boss);
  return state;
}

function nearestPlayer(boss, players) {
  let nearest = players[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const player of players) {
    const candidateDistance = distance(player.location, boss.location);
    if (candidateDistance < nearestDistance) {
      nearest = player;
      nearestDistance = candidateDistance;
    }
  }
  return nearest;
}

function currentTarget(boss, players, state) {
  const stored = players.find((player) => player.id === state.targetId);
  if (stored) {
    return stored;
  }

  const nearest = nearestPlayer(boss, players);
  state.targetId = nearest?.id;
  return nearest;
}


function setHeadTracking(boss, target) {
  if (!isEntityUsable(boss)) return;
  if (!isEntityUsable(target)) {
    attempt(() => boss.setProperty("bomd:head_yaw", 0), "neutral Night Lich head yaw");
    attempt(() => boss.setProperty("bomd:head_pitch", 0), "neutral Night Lich head pitch");
    return;
  }

  const forward = boss.getViewDirection();
  const origin = boss.getHeadLocation();
  const endpoint = target.getHeadLocation();
  const dx = endpoint.x - origin.x;
  const dy = endpoint.y - origin.y;
  const dz = endpoint.z - origin.z;
  const horizontalDistanceToTarget = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
  const forwardLength = Math.max(0.001, Math.sqrt(forward.x * forward.x + forward.z * forward.z));
  const fx = forward.x / forwardLength;
  const fz = forward.z / forwardLength;
  const tx = dx / horizontalDistanceToTarget;
  const tz = dz / horizontalDistanceToTarget;
  const dot = Math.max(-1, Math.min(1, fx * tx + fz * tz));
  const cross = fz * tx - fx * tz;
  const yaw = Math.max(-55, Math.min(55, Math.atan2(cross, dot) * 180 / Math.PI));
  const pitch = Math.max(-35, Math.min(35, Math.atan2(dy, horizontalDistanceToTarget) * 180 / Math.PI));

  attempt(() => boss.setProperty("bomd:head_yaw", yaw), "track Night Lich head yaw");
  attempt(() => boss.setProperty("bomd:head_pitch", pitch), "track Night Lich head pitch");
}

function maybeSwitchTarget(boss, players, state, now) {
  const visiblePlayers = players.filter((player) =>
    hasDirectLichLineOfSight(boss, player)
  );
  const attackerId = highestRememberedAttacker(
    state.damageMemory,
    visiblePlayers.map((player) => player.id),
    now
  );
  if (attackerId && Math.random() < 0.5) {
    state.targetId = attackerId;
  }
  return currentTarget(boss, players, state);
}

function chooseWeighted(entries) {
  const totalWeight = entries.reduce(
    (total, entry) => total + Math.max(0, entry.weight),
    0
  );
  let cursor = Math.random() * totalWeight;

  for (const entry of entries) {
    cursor -= Math.max(0, entry.weight);
    if (cursor <= 0) {
      return entry.attack;
    }
  }
  return entries[entries.length - 1].attack;
}

function distanceTraveled(positionHistory) {
  let total = 0;
  for (let index = 1; index < positionHistory.length; index += 1) {
    total += distance(
      positionHistory[index - 1],
      positionHistory[index]
    );
  }
  return total;
}

function selectRegularAttack(boss, target, state) {
  const targetDistance = distance(boss.location, target.location);
  const teleportWeight = calculateTeleportWeight({
    inLineOfSight: lichInLineOfSight(boss, target),
    distanceTraveled: distanceTraveled(state.positionHistory),
    targetDistance
  });
  const weights = regularAttackWeights({
    attackHistory: state.attackHistory,
    teleportWeight
  });

  return chooseWeighted([
    { attack: comet, weight: weights.comet },
    {
      attack: magicMissileVolley,
      weight: weights.magic_missile_volley
    },
    { attack: summonPhantoms, weight: weights.summon_phantoms },
    { attack: teleport, weight: weights.teleport }
  ]);
}


function saveRageQueue(boss, state) {
  writeStringArrayProperty(
    boss,
    RAGE_QUEUE_PROPERTY,
    state.rageQueue.map((attack) => attack.id)
  );
}

function updatePhase(boss, state, phase) {
  if (phase <= state.phase) {
    return;
  }

  for (let crossed = state.phase + 1; crossed <= phase; crossed += 1) {
    state.rageQueue.push(...RAGE_SEQUENCE);
  }
  saveRageQueue(boss, state);
  state.phase = phase;
  boss.setProperty("bomd:phase", phase);
  spawnBurst(boss.dimension, boss.location, 42, 2.4);
  spawnParticle(boss.dimension, PHASE_RUNES_PARTICLE, {
    x: boss.location.x,
    y: boss.location.y + 4.2,
    z: boss.location.z
  });
  playSound(
    boss.dimension,
    "bomd.night_lich.rage_prepare",
    boss.location,
    1.1,
    1
  );
}

function beginAttack(boss, target, state, attack, now) {
  state.castSerial += 1;
  const serial = state.castSerial;
  state.currentAttack = attack.id;
  state.attackData = {};
  state.attackEndTick = now + attack.duration + 20;
  recordCombatEvent("lich_attack_start", {
    bossId: boss.id,
    targetId: target.id,
    attack: attack.id,
    phase: state.phase
  });
  const context = {
    boss,
    target,
    phase: state.phase,
    home: state.home,
    attackData: state.attackData,
    isCurrent() {
      return (
        isEntityUsable(boss) &&
        stateByBossId.get(boss.id) === state &&
        state.castSerial === serial
      );
    }
  };
  state.attackContext = context;

  const executed = runSafely(
    () => attack.execute(context),
    `prepare Night Lich attack ${attack.id}`
  );
  if (!executed || !setLichServerAttack(boss, attack.id)) {
    cancelCurrentAttack(boss, state);
    state.nextAttackTick = now + 20;
    return false;
  }
  if (!attack.id.startsWith("rage_")) {
    state.attackHistory = appendAttackHistory(state.attackHistory, attack.id);
    writeStringArrayProperty(boss, ATTACK_HISTORY_PROPERTY, state.attackHistory);
    boss.setDynamicProperty(PREVIOUS_ATTACK_PROPERTY, attack.id);
  }
  state.nextAttackTick = now + attack.duration + bossRecoveryTicks();
  return true;
}

function steerBoss(boss, target, state, now) {
  // Java runs movement and attack goals together. The upstream selector keeps
  // its prior direction and changes course gradually instead of snapping into
  // a deterministic Bedrock orbit. Movement therefore continues while
  // casting, including the teleport wind-up.
  const combatTarget = {
    x: target.location.x,
    y: target.location.y + 1.1,
    z: target.location.z
  };
  tickUpstreamFlight(
    boss,
    combatTarget,
    state.movement,
    {
      reactionDistance: 4,
      minRange: 15,
      maxRange: 30,
      flyingSpeed: 5,
      speedScale: 0.17,
      response: 0.055,
      maximumImpulse: 0.11,
      mass: 120,
      bounds: { width: 1.8, height: 3.0 }
    }
  );

  // The 1.3/1.4 safety leash teleported the Lich to its spawn point as soon as
  // it crossed 24 vertical blocks from home. Java has no such combat reset. A
  // weak vertical correction keeps Bedrock's randomized flight near the target
  // without visibly snapping or cancelling an attack.
  const verticalDelta = combatTarget.y - (boss.location.y + 1.5);
  if (Math.abs(verticalDelta) > 20) {
    const verticalImpulse = Math.max(
      -0.075,
      Math.min(0.075, verticalDelta * 0.006)
    );
    attempt(
      () => boss.applyImpulse({ x: 0, y: verticalImpulse, z: 0 }),
      "correct Night Lich combat altitude"
    );
  }
}

function emitCastingEyeGlow(boss, state, now) {
  if (now - state.lastEyeGlowTick < 4) {
    return;
  }

  const casting =
    attempt(
      () => boss.getProperty("bomd:casting"),
      "read Night Lich casting glow state"
    ) === true;
  const animationState = attempt(
    () => boss.getProperty("bomd:animation_state"),
    "read Night Lich glow animation state"
  );
  if (
    !casting ||
    animationState === ANIMATION_STATE.teleporting
  ) {
    return;
  }

  state.lastEyeGlowTick = now;
  const view =
    attempt(
      () => boss.getViewDirection(),
      "read Night Lich glow direction"
    ) ?? { x: 0, y: 0, z: 1 };
  const horizontalLength = Math.max(
    0.001,
    Math.sqrt(view.x * view.x + view.z * view.z)
  );
  const forward = {
    x: view.x / horizontalLength,
    z: view.z / horizontalLength
  };
  const right = {
    x: -forward.z,
    z: forward.x
  };
  const head = boss.getHeadLocation();
  const eyeCenter = {
    x: head.x + forward.x * 0.5,
    y: head.y - 0.08,
    z: head.z + forward.z * 0.5
  };

  for (const side of [-1, 1]) {
    spawnParticle(boss.dimension, FROST_PARTICLE, {
      x: eyeCenter.x + right.x * 0.22 * side,
      y: eyeCenter.y,
      z: eyeCenter.z + right.z * 0.22 * side
    });
  }
}

function healTowardCurrentStage(boss, state) {
  const health = boss.getComponent("minecraft:health");
  if (!health) {
    return;
  }

  const cap = cappedHealingLimit(
    health.effectiveMax,
    state.phase
  );
  if (health.currentValue < cap) {
    health.setCurrentValue(
      Math.min(
        cap,
        health.currentValue +
          UPSTREAM_IDLE_HEAL_PER_TICK * MANAGER_INTERVAL_TICKS
      )
    );
  }
}

function cancelCurrentAttack(boss, state, reason = "cancelled") {
  if (!state.currentAttack) {
    setLichServerAttack(boss, "idle");
    return;
  }
  const endedAttack = state.currentAttack;
  state.castSerial += 1;
  state.currentAttack = undefined;
  state.attackData = {};
  state.attackContext = undefined;
  state.attackEndTick = 0;
  boss.triggerEvent("bomd:end_teleport");
  setLichServerAttack(boss, "idle");
  setAnimationState(boss, ANIMATION_STATE.idle);
  recordCombatEvent("lich_attack_end", {
    bossId: boss.id,
    attack: endedAttack,
    reason
  });
}

function returnTowardHome(boss, state) {
  const delta = subtract(state.home, boss.location);
  const homeDistance = distance(boss.location, state.home);
  if (homeDistance <= 2) {
    const velocity = attempt(() => boss.getVelocity(), "read idle Night Lich velocity") ?? { x: 0, y: 0, z: 0 };
    attempt(
      () => boss.applyImpulse(scale(velocity, -0.08)),
      "dampen idle Night Lich velocity"
    );
    return;
  }
  const direction = normalize(delta);
  const currentVelocity = attempt(() => boss.getVelocity(), "read returning Night Lich velocity") ?? { x: 0, y: 0, z: 0 };
  const desiredVelocity = scale(direction, 2.4);
  const acceleration = scale(subtract(desiredVelocity, currentVelocity), 1 / 120);
  attempt(() => boss.applyImpulse(acceleration), "return Night Lich toward home");
  debugMovement(boss.dimension, boss.location, direction, 5);
}

function tickBoss(boss, now) {
  if (!isEntityUsable(boss)) {
    stateByBossId.delete(boss.id);
    return;
  }


  const state = stateByBossId.get(boss.id) ?? initializeBoss(boss, now);
  rememberBossSnapshot(boss);
  const health = boss.getComponent("minecraft:health");
  if (!health) return;
  if (health.currentValue <= 0) {
    beginRememberedBossDeath(boss, "Night Lich manager");
    return;
  }

  updatePhase(
    boss,
    state,
    healthPhase(health.currentValue, health.effectiveMax)
  );
  state.positionHistory.push({ ...boss.location });
  if (state.positionHistory.length > 10) state.positionHistory.shift();

  const players = nearbyPlayers(boss);
  const hasTarget = players.length > 0;
  if (shouldCappedHeal(hasTarget)) {
    // Java preserves the current rage stage and heals only up to that stage cap.
    // The encounter is not reset merely because players leave for a few seconds.
    healTowardCurrentStage(boss, state);
    const firstEmptyTick = state.emptySinceTick === undefined;
    state.emptySinceTick ??= now;
    state.targetId = undefined;
    setHeadTracking(boss, undefined);
    cancelCurrentAttack(boss, state);
    if (firstEmptyTick) state.nextAttackTick = now + 80;
    returnTowardHome(boss, state);
    recordBossSample("night_lich", boss, {
      phase: state.phase,
      attack: undefined,
      targetId: undefined,
      idle: true
    });
    return;
  }

  const firstEngagement = !state.engaged;
  state.engaged = true;
  state.emptySinceTick = undefined;
  if (firstEngagement) {
    state.nextAttackTick = Math.max(state.nextAttackTick, now + 80);
  }
  let target = currentTarget(boss, players, state);
  if (!target) {
    return;
  }

  if (state.forcedTeleportTargetId) {
    const forcedTarget = players.find(
      (player) => player.id === state.forcedTeleportTargetId
    );
    state.forcedTeleportTargetId = undefined;
    if (forcedTarget) {
      state.targetId = forcedTarget.id;
      cancelCurrentAttack(boss, state);
      beginAttack(boss, forcedTarget, state, teleport, now);
      return;
    }
  }

  if (now - state.lastIdleParticleTick >= 8) {
    state.lastIdleParticleTick = now;
    const angle = now * 0.19;
    spawnParticle(boss.dimension, SOUL_FLAME_PARTICLE, {
      x: boss.location.x + Math.cos(angle) * 1.4,
      y: boss.location.y + 1.4 + Math.sin(angle * 0.7) * 0.4,
      z: boss.location.z + Math.sin(angle) * 1.4
    });
  }

  if (state.currentAttack && now >= state.attackEndTick) {
    cancelCurrentAttack(boss, state, "timeline_watchdog");
    state.nextAttackTick = Math.max(state.nextAttackTick, now + 10);
  }

  attempt(
    () =>
      boss.lookAt({
        x: target.location.x,
        y: target.location.y + 1.4,
        z: target.location.z
      }),
    "face Night Lich target"
  );
  setHeadTracking(boss, target);
  emitCastingEyeGlow(boss, state, now);

  // Do not teleport an engaged Lich back to its spawn/home position. The Java
  // boss has no combat leash teleport; its 15-30 block movement range returns
  // it toward the player. Home is used only while the encounter is idle.
  steerBoss(boss, target, state, now);
  recordBossSample("night_lich", boss, {
    phase: state.phase,
    attack: state.currentAttack,
    animationState: attempt(
      () => boss.getProperty("bomd:animation_state"),
      "read Night Lich comparison animation state"
    ),
    targetId: target.id,
    targetDistance: distance(boss.location, target.location),
    javaLineOfSight: lichInLineOfSight(boss, target),
    blockedTicks: state.movement.blockedTicks,
    stagnantTicks: state.movement.stagnantTicks
  });
  if (state.currentAttack) return;
  if (now < state.nextAttackTick) {
    return;
  }

  let attack;
  if (state.rageQueue.length > 0) {
    attack = state.rageQueue.shift();
    saveRageQueue(boss, state);
  } else {
    target = maybeSwitchTarget(boss, players, state, now) ?? target;
    attack = selectRegularAttack(boss, target, state);
  }
  if (attack) {
    beginAttack(boss, target, state, attack, now);
  }
}

function handleLichTimelineEvent(entity, message) {
  if (!isEntityUsable(entity) || entity.typeId !== BOSS_TYPE) return;
  const separator = message.indexOf(":");
  const attackId = separator >= 0 ? message.slice(0, separator) : message;
  const pulse = separator >= 0 ? message.slice(separator + 1) : "";
  const state = stateByBossId.get(entity.id);
  if (!state || state.currentAttack !== attackId || !state.attackContext) {
    recordCombatEvent("lich_timeline_stale", {
      bossId: entity.id,
      message,
      currentAttack: state?.currentAttack
    });
    return;
  }
  const attack = [comet, magicMissileVolley, summonPhantoms, teleport, rageComets, rageMissiles, rageMinions]
    .find((candidate) => candidate.id === attackId);
  if (pulse === "complete") {
    if (attack?.pulse) {
      runSafely(() => attack.pulse(state.attackContext, pulse), `Night Lich completion pulse ${message}`);
    }
    cancelCurrentAttack(entity, state, "behavior_timeline_complete");
    return;
  }
  if (attack?.pulse) {
    runSafely(() => attack.pulse(state.attackContext, pulse), `Night Lich behavior pulse ${message}`);
  }
  recordCombatEvent("lich_timeline_pulse", { bossId: entity.id, attack: attackId, pulse });
}

function damagingPlayer(damageSource) {
  const direct = damageSource.damagingEntity;
  if (isEntityUsable(direct) && direct.typeId === "minecraft:player") {
    return direct;
  }

  const projectile = damageSource.damagingProjectile;
  const owner = attempt(
    () => projectile?.getComponent("minecraft:projectile")?.owner,
    "resolve Night Lich projectile attacker"
  );
  return isEntityUsable(owner) && owner.typeId === "minecraft:player"
    ? owner
    : undefined;
}

function rememberBossDamage(event) {
  const boss = event.hurtEntity;
  if (boss.typeId !== BOSS_TYPE || event.damage <= 0) {
    return;
  }
  const player = damagingPlayer(event.damageSource);
  if (!isEntityUsable(player)) {
    return;
  }

  const state =
    stateByBossId.get(boss.id) ??
    initializeBoss(boss, system.currentTick);
  state.damageMemory = rememberDamage(state.damageMemory, {
    playerId: player.id,
    damage: event.damage,
    tick: system.currentTick
  });
  if (state.targetId === undefined) {
    state.forcedTeleportTargetId = player.id;
    state.nextAttackTick = system.currentTick;
  }
}

function discoverBosses(now) {
  lastDiscoveryTick = now;
  for (const dimensionId of ["overworld", "nether", "the_end"]) {
    attempt(() => {
      for (const boss of world.getDimension(dimensionId).getEntities({ type: BOSS_TYPE })) {
        trackedBosses.set(boss.id, boss);
        if (!stateByBossId.has(boss.id)) initializeBoss(boss, now);
      }
    }, `discover ${dimensionId} Night Liches`);
  }
}

function managerTick() {
  const now = system.currentTick;
  if (now - lastDiscoveryTick >= 40) {
    discoverBosses(now);
  }
  let activeLichExists = false;
  for (const [bossId, boss] of trackedBosses) {
    if (!isEntityUsable(boss)) {
      trackedBosses.delete(bossId);
      stateByBossId.delete(bossId);
      continue;
    }
    const health = attempt(() => boss.getComponent("minecraft:health"), "read Night Lich global night health");
    if (health && health.currentValue > 0) activeLichExists = true;
    attempt(() => tickBoss(boss, now), `tick Night Lich ${boss.id}`);
  }
  if (activeLichExists) {
    attempt(() => world.setTimeOfDay(16000), "hold global eternal midnight");
  }
}

export function startNightLichManager() {
  if (started) {
    return;
  }
  started = true;
  setLichTimelineHandler(handleLichTimelineEvent);
  world.afterEvents.entitySpawn.subscribe((event) => {
    if (event.entity.typeId !== BOSS_TYPE) return;
    trackedBosses.set(event.entity.id, event.entity);
    system.run(() => {
      if (isEntityUsable(event.entity) && !stateByBossId.has(event.entity.id)) {
        initializeBoss(event.entity, system.currentTick);
      }
    });
  });
  world.beforeEvents.entityHurt.subscribe((event) => {
    if (event.hurtEntity.typeId !== BOSS_TYPE || event.damage <= 0) return;
    event.damage = scaleDamageToBoss(event.damage);
  });
  world.afterEvents.entityHurt.subscribe((event) => {
    attempt(
      () => rememberBossDamage(event),
      "remember Night Lich damage"
    );
  });
  system.runInterval(managerTick, MANAGER_INTERVAL_TICKS);
}
