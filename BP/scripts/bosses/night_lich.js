// @ts-check

import { system, world } from "@minecraft/server";
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
  BALANCE_VERSION_PROPERTY,
  BOSS_TYPE,
  COMBAT_RADIUS,
  FROST_PARTICLE,
  HOME_X_PROPERTY,
  HOME_Y_PROPERTY,
  HOME_Z_PROPERTY,
  LEASH_RADIUS,
  MANAGER_INTERVAL_TICKS,
  PHASE_RUNES_PARTICLE,
  PREVIOUS_ATTACK_PROPERTY,
  RAGE_QUEUE_PROPERTY,
  RESET_DELAY_TICKS,
  SCALED_PLAYERS_PROPERTY,
  SOUL_FLAME_PARTICLE
} from "../core/config.js";
import {
  appendAttackHistory,
  cappedHealingLimit,
  calculateTeleportWeight,
  clampPlayerCount,
  healthPhase,
  highestRememberedAttacker,
  regularAttackWeights,
  rememberDamage,
  shouldCappedHeal,
  UPSTREAM_IDLE_HEAL_PER_TICK
} from "../core/lich_logic.js";
import {
  balanceRevision,
  effectiveEncounterPlayers
} from "../core/balance.js";
import {
  attempt,
  isEntityUsable,
  runSafely
} from "../core/safe.js";
import {
  distance,
  horizontalDistance,
  normalize,
  scale,
  subtract
} from "../core/vector.js";
import {
  isBossCombatPlayer,
  markBossAggressor
} from "../core/combat_target.js";
import {
  playSound,
  setAnimationState,
  spawnBurst,
  spawnParticle
} from "../visuals/frost.js";
import { cleanupEncounterEntities } from "./encounter_cleanup.js";

const stateByBossId = new Map();
const RAGE_SEQUENCE = Object.freeze([
  rageComets,
  rageMissiles,
  rageMinions
]);
const RAGE_ATTACKS_BY_ID = new Map(
  RAGE_SEQUENCE.map((attack) => [attack.id, attack])
);
const END_TICK_CALLBACK_ATTACKS = new Set([
  summonPhantoms.id,
  rageMinions.id
]);
const BALANCE_VERSION = 5;
const RECOVERY_SCAN_TICKS = 200;
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
    .filter(isBossCombatPlayer);
}

function hasClearRay(boss, target, requireTargetFacing = false) {
  const origin = boss.getHeadLocation();
  const endpoint = target.getHeadLocation();
  const delta = subtract(endpoint, origin);
  const rayDistance = distance(origin, endpoint);
  if (rayDistance <= 1) {
    return true;
  }

  const blocked = attempt(
    () =>
      boss.dimension.getBlockFromRay(origin, normalize(delta), {
        maxDistance: Math.max(0.1, rayDistance - 0.75),
        includeLiquidBlocks: false,
        includePassableBlocks: false
      }),
    "trace Night Lich line of sight"
  );
  if (blocked) {
    return false;
  }
  if (!requireTargetFacing) {
    return true;
  }

  const view = target.getViewDirection();
  const directionToLich = normalize(
    subtract(origin, target.getHeadLocation())
  );
  return (
    view.x * directionToLich.x +
      view.y * directionToLich.y +
      view.z * directionToLich.z >
    0
  );
}

function applyLichScale(boss, requestedCount) {
  const playerCount = effectiveEncounterPlayers(
    clampPlayerCount(requestedCount)
  );
  const storedCount = readNumberProperty(boss, SCALED_PLAYERS_PROPERTY);
  const storedVersion = readNumberProperty(boss, BALANCE_VERSION_PROPERTY);
  const activeRevision = balanceRevision(BALANCE_VERSION);
  if (storedCount === playerCount && storedVersion === activeRevision) {
    return playerCount;
  }
  const health = boss.getComponent("minecraft:health");
  const ratio = health
    ? health.currentValue / Math.max(1, health.effectiveMax)
    : 1;
  boss.triggerEvent(`bomd:scale_${playerCount}`);
  boss.setDynamicProperty(SCALED_PLAYERS_PROPERTY, playerCount);
  boss.setDynamicProperty(BALANCE_VERSION_PROPERTY, activeRevision);
  system.runTimeout(() => {
    if (!isEntityUsable(boss)) {
      return;
    }
    const scaled = boss.getComponent("minecraft:health");
    if (!scaled) {
      return;
    }
    scaled.setCurrentValue(
      Math.max(1, Math.min(scaled.effectiveMax, scaled.effectiveMax * ratio))
    );
  }, 1);
  return playerCount;
}

function initializeBoss(boss, now) {
  const home = readHome(boss);
  const initialPlayers = nearbyPlayers(boss);
  const storedPlayers = readNumberProperty(boss, SCALED_PLAYERS_PROPERTY);
  const playerCount = applyLichScale(
    boss,
    storedPlayers ?? initialPlayers.length
  );

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
  boss.triggerEvent("bomd:end_teleport");
  setAnimationState(boss, ANIMATION_STATE.idle);

  const state = {
    home,
    playerCount,
    attackHistory,
    currentAttack: /** @type {string | undefined} */ (undefined),
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

function maybeSwitchTarget(boss, players, state, now) {
  const visiblePlayers = players.filter((player) =>
    hasClearRay(boss, player)
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
    inLineOfSight: hasClearRay(boss, target, true),
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
  state.attackEndTick = now + attack.duration;
  const context = {
    boss,
    target,
    phase: state.phase,
    playerCount: state.playerCount,
    home: state.home,
    isCurrent() {
      return (
        isEntityUsable(boss) &&
        stateByBossId.get(boss.id) === state &&
        state.castSerial === serial
      );
    }
  };

  const executed = runSafely(
    () => attack.execute(context),
    `start Night Lich attack ${attack.id}`
  );
  if (!executed) {
    cancelCurrentAttack(boss, state);
    state.nextAttackTick = now + 20;
    return false;
  }
  if (!attack.id.startsWith("rage_")) {
    state.attackHistory = appendAttackHistory(
      state.attackHistory,
      attack.id
    );
    writeStringArrayProperty(
      boss,
      ATTACK_HISTORY_PROPERTY,
      state.attackHistory
    );
    boss.setDynamicProperty(PREVIOUS_ATTACK_PROPERTY, attack.id);
  }
  state.nextAttackTick = now + attack.duration;
  return true;
}

function steerBoss(boss, target, state, now) {
  if (state.currentAttack === "teleport") {
    return;
  }

  if (now >= state.nextStrafeDecisionTick) {
    if (Math.random() < 0.5) {
      state.strafeDirection *= -1;
    }
    state.nextStrafeDecisionTick =
      now + 40 + Math.floor(Math.random() * 61);
  }

  const dx = target.location.x - boss.location.x;
  const dz = target.location.z - boss.location.z;
  const horizontal = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
  const toward = normalize({ x: dx, y: 0, z: dz });
  let desiredVelocity;

  if (horizontal < 15) {
    desiredVelocity = scale(toward, -0.32);
  } else if (horizontal > 30) {
    desiredVelocity = scale(toward, 0.32);
  } else {
    desiredVelocity = {
      x: -toward.z * 0.2 * state.strafeDirection,
      y: 0,
      z: toward.x * 0.2 * state.strafeDirection
    };
  }

  const desiredY = target.location.y + 6;
  desiredVelocity.y = Math.max(
    -0.16,
    Math.min(0.16, (desiredY - boss.location.y) * 0.04)
  );

  const velocity =
    attempt(() => boss.getVelocity(), "read Night Lich velocity") ??
    { x: 0, y: 0, z: 0 };
  const response = 0.24;
  const impulse = {
    x: (desiredVelocity.x - velocity.x) * response,
    y: (desiredVelocity.y - velocity.y) * response,
    z: (desiredVelocity.z - velocity.z) * response
  };
  attempt(() => boss.applyImpulse(impulse), "steer Night Lich");
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

function cancelCurrentAttack(boss, state) {
  if (!state.currentAttack) {
    return;
  }
  state.castSerial += 1;
  state.currentAttack = undefined;
  state.attackEndTick = 0;
  boss.triggerEvent("bomd:end_teleport");
  setAnimationState(boss, ANIMATION_STATE.idle);
}

function resetEncounter(boss, state, now) {
  cancelCurrentAttack(boss, state);
  state.rageQueue.length = 0;
  saveRageQueue(boss, state);
  const health = boss.getComponent("minecraft:health");
  health?.resetToMaxValue();
  boss.teleport(state.home);
  boss.setProperty("bomd:phase", 1);
  boss.setDynamicProperty(PREVIOUS_ATTACK_PROPERTY, undefined);
  boss.setDynamicProperty(ATTACK_HISTORY_PROPERTY, undefined);
  setAnimationState(boss, ANIMATION_STATE.idle);
  cleanupEncounterEntities(
    boss.dimension,
    state.home,
    COMBAT_RADIUS + 40
  );
  state.phase = 1;
  state.attackHistory = [];
  state.nextAttackTick = now + 80;
  state.emptySinceTick = now;
  state.engaged = false;
  state.targetId = undefined;
  state.forcedTeleportTargetId = undefined;
  state.damageMemory = [];
  state.positionHistory = [{ ...state.home }];
  state.nextStrafeDecisionTick =
    now + 40 + Math.floor(Math.random() * 61);
}

function tickBoss(boss, now) {
  if (!isEntityUsable(boss)) {
    stateByBossId.delete(boss.id);
    return;
  }

  const state = stateByBossId.get(boss.id) ?? initializeBoss(boss, now);
  const health = boss.getComponent("minecraft:health");
  if (!health || health.currentValue <= 0) {
    return;
  }

  updatePhase(
    boss,
    state,
    healthPhase(health.currentValue, health.effectiveMax)
  );
  attempt(() => world.setTimeOfDay(16000), "hold eternal midnight");
  state.positionHistory.push({ ...boss.location });
  state.positionHistory = state.positionHistory.slice(-10);

  const players = nearbyPlayers(boss);
  const hasTarget = players.length > 0;
  if (shouldCappedHeal(hasTarget)) {
    // CappedHeal in the Java mod only runs while the mob has no target.
    healTowardCurrentStage(boss, state);
    attempt(() => boss.clearVelocity(), "stop idle Night Lich drift");
    state.emptySinceTick ??= now;
    state.targetId = undefined;
    cancelCurrentAttack(boss, state);
    state.nextAttackTick = now + 80;
    if (
      state.engaged &&
      now - state.emptySinceTick >= RESET_DELAY_TICKS
    ) {
      resetEncounter(boss, state, now);
    }
    return;
  }

  const firstEngagement = !state.engaged;
  state.engaged = true;
  state.emptySinceTick = undefined;
  if (now % 20 === 0) {
    state.playerCount = applyLichScale(boss, players.length);
  }
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

  if (
    state.currentAttack &&
    now >= state.attackEndTick
  ) {
    if (END_TICK_CALLBACK_ATTACKS.has(state.currentAttack)) {
      state.nextAttackTick = Math.max(
        state.nextAttackTick,
        now + MANAGER_INTERVAL_TICKS
      );
    }
    state.currentAttack = undefined;
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
  emitCastingEyeGlow(boss, state, now);

  if (
    horizontalDistance(boss.location, state.home) > LEASH_RADIUS ||
    Math.abs(boss.location.y - state.home.y) > 24
  ) {
    cancelCurrentAttack(boss, state);
    boss.teleport(state.home, { facingLocation: target.location });
    spawnBurst(boss.dimension, state.home, 26, 1.5);
    state.nextAttackTick = now + 30;
    return;
  }

  steerBoss(boss, target, state, now);
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
  if (boss.typeId !== BOSS_TYPE) {
    return;
  }
  const player = damagingPlayer(event.damageSource);
  if (!isBossCombatPlayer(player)) {
    return;
  }
  markBossAggressor(player);
  if (event.damage <= 4) {
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
  if (!state.engaged || state.targetId === undefined) {
    state.forcedTeleportTargetId = player.id;
    state.nextAttackTick = system.currentTick;
  }
}

function recoveryScan() {
  const seenIds = new Set();
  for (const dimensionId of ["overworld", "nether", "the_end"]) {
    const bosses = attempt(
      () => world.getDimension(dimensionId).getEntities({ type: BOSS_TYPE }),
      `recover Night Liches in ${dimensionId}`
    ) ?? [];
    for (const boss of bosses) {
      seenIds.add(boss.id);
      if (!stateByBossId.has(boss.id)) {
        initializeBoss(boss, system.currentTick);
      }
    }
  }
  for (const bossId of stateByBossId.keys()) {
    if (!seenIds.has(bossId)) {
      stateByBossId.delete(bossId);
    }
  }
}

function managerTick() {
  const now = system.currentTick;
  for (const bossId of stateByBossId.keys()) {
    const boss = attempt(
      () => world.getEntity(bossId),
      "resolve tracked Night Lich"
    );
    if (isEntityUsable(boss)) {
      attempt(() => tickBoss(boss, now), `tick Night Lich ${bossId}`);
    }
  }
}

export function startNightLichManager() {
  if (started) {
    return;
  }
  started = true;
  world.afterEvents.entityHurt.subscribe((event) => {
    attempt(
      () => rememberBossDamage(event),
      "remember Night Lich damage"
    );
  });
  world.afterEvents.entitySpawn.subscribe((event) => {
    if (event.entity.typeId !== BOSS_TYPE) {
      return;
    }
    system.run(() => {
      if (isEntityUsable(event.entity)) {
        initializeBoss(event.entity, system.currentTick);
      }
    });
  });
  recoveryScan();
  system.runInterval(managerTick, MANAGER_INTERVAL_TICKS);
  system.runInterval(recoveryScan, RECOVERY_SCAN_TICKS);
}
