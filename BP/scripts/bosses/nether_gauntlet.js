// @ts-check

import { EntityDamageCause, GameMode, system, world } from "@minecraft/server";
import { blindness } from "../attacks/nether_gauntlet/blindness.js";
import { laser } from "../attacks/nether_gauntlet/laser.js";
import { normalPunch } from "../attacks/nether_gauntlet/normal_punch.js";
import { spinPunch } from "../attacks/nether_gauntlet/spin_punch.js";
import {
  GAUNTLET_ANIMATION_STATE,
  GAUNTLET_ATTACK_PREPARE_TIMEOUT_TICKS,
  GAUNTLET_BEDROCK_STEERING_MASS,
  GAUNTLET_COMBAT_ARMOR,
  GAUNTLET_COMBAT_RADIUS,
  GAUNTLET_DORMANT_ARMOR,
  GAUNTLET_HOME_X_PROPERTY,
  GAUNTLET_HOME_Y_PROPERTY,
  GAUNTLET_HOME_Z_PROPERTY,
  GAUNTLET_INITIAL_ATTACK_DELAY_TICKS,
  GAUNTLET_LEASH_RADIUS,
  GAUNTLET_LAUNCH_FORWARD_SPEED,
  GAUNTLET_MANAGER_INTERVAL_TICKS,
  GAUNTLET_MELEE_RAY_LENGTH,
  GAUNTLET_PUNCH_LAUNCH_MAX_RANGE,
  GAUNTLET_PUNCH_LAUNCH_MIN_RANGE,
  GAUNTLET_SMOKE_PARTICLE,
  GAUNTLET_SPARK_PARTICLE,
  GAUNTLET_SWIRL_LAUNCH_MAX_RANGE,
  GAUNTLET_SWIRL_LAUNCH_MIN_RANGE,
  GAUNTLET_TRAVEL_DRAG,
  GAUNTLET_TARGET_ORIGIN_Y_OFFSET,
  GAUNTLET_VERTICAL_CORRECTION_STRENGTH,
  GAUNTLET_VERTICAL_TOLERANCE,
  GAUNTLET_TYPE
} from "../core/gauntlet_config.js";
import { appendGauntletHistory, chooseGauntletAttack } from "../core/gauntlet_logic.js";
import { beginRememberedBossDeath, rememberBossSnapshot } from "./death_events.js";
import { debugMovement, debugObbs, recordBossSample, recordCombatEvent } from "../core/combat_debug.js";
import { scaleDamageToBoss } from "../core/difficulty.js";
import { appendDamageMemory, highestDamageAttacker } from "../core/damage_memory.js";
import { recentExplosionOrigin } from "../core/explosion_history.js";
import { damageAfterJavaArmor } from "../core/gauntlet_vulnerability.js";
import {
  GAUNTLET_PART,
  firstGauntletRayPart,
  firstGauntletSegmentPart,
  gauntletEyeCenter,
  gauntletObbs
} from "../core/gauntlet_hitboxes.js";
import {
  applyGauntletTravelDrag,
  createGauntletNavigationState,
  gauntletChargePathClear,
  gauntletFacingErrorDegrees,
  tickGauntletAttackPositioning,
  tickGauntletRoaming
} from "../core/gauntlet_navigation.js";
import { projectileSegment } from "../core/projectile_history.js";
import { setGauntletServerAttack, setGauntletTimelineHandler } from "../core/hybrid_timeline.js";
import {
  GAUNTLET_PROXY_TYPE,
  cleanupInvalidGauntletProxies,
  proxyParentId,
  proxyPart,
  removeGauntletProxies,
  updateGauntletProxies
} from "../core/gauntlet_proxies.js";
import { translate } from "../core/i18n.js";
import { attempt, isEntityUsable, runSafely } from "../core/safe.js";
import { dimensionHeightRange, isLocationLoaded } from "../core/world_bounds.js";
import { distance, horizontalDistance, normalize, scale, subtract } from "../core/vector.js";
import {
  playGauntletSound,
  resetGauntletVisuals,
  setGauntletAnimation,
  setGauntletEyeOpen,
  spawnGauntletBurst,
  spawnGauntletParticle
} from "../visuals/nether_gauntlet.js";

/** @typedef {{id:string,duration:number,execute:(context:any)=>void,pulse?:(context:any,pulse:string)=>void,tick?:(context:any,localTick:number)=>void}} GauntletAttack */
/** @type {Map<string, GauntletAttack>} */
const ATTACKS = new Map();
for (const attack of [normalPunch, laser, spinPunch, blindness]) ATTACKS.set(attack.id, attack);

const stateByBossId = new Map();
const trackedBosses = new Map();
const lastDeflectTickByBossId = new Map();
const lastEyeHintTickByPlayerId = new Map();
const manualProxyDamageByBossId = new Map();
const acceptedHitTickByKey = new Map();
let lastDiscoveryTick = -999;
let purgedLoadedProxies = false;
let started = false;

const BYPASS_DAMAGE_CAUSES = new Set(["void", "suicide", "selfDestruct", "command", "kill"]);

const COMBAT_PHASE = Object.freeze({
  dormant: "dormant",
  reposition: "reposition",
  prepare: "prepare",
  attack: "attack"
});

function readNumberProperty(entity, id) {
  const value = entity.getDynamicProperty(id);
  return typeof value === "number" ? value : undefined;
}

function readHome(boss) {
  const x = readNumberProperty(boss, GAUNTLET_HOME_X_PROPERTY);
  const y = readNumberProperty(boss, GAUNTLET_HOME_Y_PROPERTY);
  const z = readNumberProperty(boss, GAUNTLET_HOME_Z_PROPERTY);
  if (x !== undefined && y !== undefined && z !== undefined) return { x, y, z };
  const home = { ...boss.location };
  boss.setDynamicProperty(GAUNTLET_HOME_X_PROPERTY, home.x);
  boss.setDynamicProperty(GAUNTLET_HOME_Y_PROPERTY, home.y);
  boss.setDynamicProperty(GAUNTLET_HOME_Z_PROPERTY, home.z);
  return home;
}

function playersNear(boss) {
  return boss.dimension
    .getPlayers({ location: boss.location, maxDistance: GAUNTLET_COMBAT_RADIUS })
    .filter((player) => {
      const mode = player.getGameMode();
      return mode === GameMode.Survival || mode === GameMode.Adventure;
    });
}

function nearest(boss, players) {
  let best;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const player of players) {
    const candidate = distance(boss.location, player.location);
    if (candidate < bestDistance) {
      best = player;
      bestDistance = candidate;
    }
  }
  return best;
}

function initializeBoss(boss, now) {
  boss.nameTag = "Nether Gauntlet";
  resetGauntletVisuals(boss, true);
  setGauntletServerAttack(boss, "idle");
  const home = readHome(boss);
  const state = {
    home,
    spawnTick: now,
    aggroTick: undefined,
    engaged: false,
    phase: COMBAT_PHASE.dormant,
    targetId: undefined,
    currentAttack: undefined,
    pendingAttackId: undefined,
    prepareStartTick: 0,
    attackStartTick: 0,
    attackEndTick: 0,
    attackData: {},
    attackContext: undefined,
    castSerial: 0,
    nextAttackTick: Number.POSITIVE_INFINITY,
    history: [],
    damageMemory: [],
    emptySinceTick: now,
    outOfBoundsSinceTick: undefined,
    lastHomeDistance: distance(boss.location, home),
    lastHomeProgressTick: now,
    movement: createGauntletNavigationState(),
    lastIdleParticleTick: now,
    nextIdleSoundTick: now + 100,
    lastHurtSoundTick: now - 20,
    eyeOpen: true
  };
  stateByBossId.set(boss.id, state);
  trackedBosses.set(boss.id, boss);
  recordCombatEvent("gauntlet_state", { bossId: boss.id, phase: state.phase, reason: "spawn" });
  return state;
}

function healthRatio(boss) {
  const health = boss.getComponent("minecraft:health");
  return health && health.effectiveMax > 0 ? health.currentValue / health.effectiveMax : 1;
}

/** Java switches targets when choosing a new move, not every few movement ticks. */
function chooseTarget(boss, players, state, now, force = false) {
  const current = players.find((player) => player.id === state.targetId);
  if (!force && current) return current;
  const rememberedId = highestDamageAttacker(state.damageMemory, players.map((player) => player.id), now);
  const best = players.find((player) => player.id === rememberedId) ?? current ?? nearest(boss, players);
  state.targetId = best?.id;
  return best;
}

function updateEyeVulnerability(boss, state) {
  const property = attempt(
    () => boss.getProperty("bomd:eye_open"),
    "read hybrid Gauntlet eye state"
  );
  const eyeOpen = property === true;
  state.eyeOpen = eyeOpen;
}

function currentEyeOpen(boss, state) {
  const property = attempt(
    () => boss.getProperty("bomd:eye_open"),
    "read authoritative Gauntlet eye property"
  );
  if (typeof property === "boolean") return property;
  return state?.eyeOpen !== false;
}

function changePhase(boss, state, phase, reason) {
  if (state.phase === phase) return;
  state.phase = phase;
  recordCombatEvent("gauntlet_state", {
    bossId: boss.id,
    phase,
    reason,
    pendingAttack: state.pendingAttackId,
    currentAttack: state.currentAttack
  });
}

function endAttack(boss, state, now, reason = "timeline_complete") {
  const endedAttack = state.currentAttack;
  state.castSerial += 1;
  state.currentAttack = undefined;
  state.attackStartTick = 0;
  state.attackData = {};
  state.attackContext = undefined;
  state.attackEndTick = 0;
  state.eyeOpen = true;
  setGauntletServerAttack(boss, "idle");
  resetGauntletVisuals(boss, true);
  changePhase(boss, state, COMBAT_PHASE.reposition, reason);
  recordCombatEvent("gauntlet_attack_end", { bossId: boss.id, attack: endedAttack, tick: now, reason });
}

function beginAttack(boss, target, state, attack, now) {
  if (!isEntityUsable(target) || target.typeId !== "minecraft:player") return false;
  const mode = target.getGameMode();
  if (mode !== GameMode.Survival && mode !== GameMode.Adventure) return false;

  state.castSerial += 1;
  const serial = state.castSerial;
  state.currentAttack = attack.id;
  state.pendingAttackId = undefined;
  state.prepareStartTick = 0;
  state.attackStartTick = now;
  state.attackEndTick = now + attack.duration + 20;
  state.nextAttackTick = now + attack.duration;
  state.attackData = {};
  state.history = appendGauntletHistory(state.history, attack.id);
  changePhase(boss, state, COMBAT_PHASE.attack, "attack_committed");
  updateEyeVulnerability(boss, state);

  recordCombatEvent("gauntlet_attack_start", {
    bossId: boss.id,
    targetId: target.id,
    attack: attack.id,
    healthPercentage: healthRatio(boss),
    distance: distance(boss.location, target.location)
  });

  const context = {
    boss,
    target,
    attackData: state.attackData,
    isCurrent() {
      return isEntityUsable(boss) && stateByBossId.get(boss.id) === state && state.castSerial === serial;
    }
  };
  state.attackContext = context;
  if (!runSafely(() => attack.execute(context), `prepare Gauntlet ${attack.id}`)) {
    endAttack(boss, state, now, "start_failed");
    state.nextAttackTick = now + 10;
    return false;
  }
  if (!setGauntletServerAttack(boss, attack.id)) {
    endAttack(boss, state, now, "timeline_start_failed");
    state.nextAttackTick = now + 10;
    return false;
  }
  return true;
}

function chooseCommittedAttack(boss, state) {
  const id = chooseGauntletAttack({
    healthPercentage: healthRatio(boss),
    history: state.history
  });
  return ATTACKS.get(id) ?? normalPunch;
}

function wrapDegrees(value) {
  let wrapped = value % 360;
  if (wrapped >= 180) wrapped -= 360;
  if (wrapped < -180) wrapped += 360;
  return wrapped;
}

function smoothFace(boss, targetPoint, yawStep = 14, pitchStep = 10) {
  const head = { x: boss.location.x, y: boss.location.y + 1.6, z: boss.location.z };
  const dx = targetPoint.x - head.x;
  const dy = targetPoint.y - head.y;
  const dz = targetPoint.z - head.z;
  const horizontal = Math.max(0.001, Math.hypot(dx, dz));
  const desiredYaw = Math.atan2(-dx, dz) * 180 / Math.PI;
  const desiredPitch = -Math.atan2(dy, horizontal) * 180 / Math.PI;
  const current = attempt(() => boss.getRotation(), "read Gauntlet rotation");
  if (!current) return;
  const yawDelta = Math.max(-yawStep, Math.min(yawStep, wrapDegrees(desiredYaw - current.y)));
  const pitchDelta = Math.max(-pitchStep, Math.min(pitchStep, desiredPitch - current.x));
  attempt(
    () => boss.setRotation({ x: current.x + pitchDelta, y: current.y + yawDelta }),
    "smooth Gauntlet facing"
  );
}

function targetCenter(target) {
  return { x: target.location.x, y: target.location.y + 0.9, z: target.location.z };
}

function targetMovementAnchor(target) {
  return {
    x: target.location.x,
    y: target.location.y + GAUNTLET_TARGET_ORIGIN_Y_OFFSET,
    z: target.location.z
  };
}

function healIdle(boss) {
  const health = boss.getComponent("minecraft:health");
  if (health && health.currentValue < health.effectiveMax) {
    attempt(() => health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + 0.5)), "heal idle Gauntlet");
  }
}

function returnTowardHome(boss, state) {
  const homeDistance = distance(boss.location, state.home);
  const currentVelocity = attempt(() => boss.getVelocity(), "read idle Gauntlet velocity") ?? { x: 0, y: 0, z: 0 };
  if (homeDistance <= 2) {
    attempt(() => boss.applyImpulse(scale(currentVelocity, -0.08)), "dampen idle Gauntlet velocity");
    return;
  }
  const direction = normalize(subtract(state.home, boss.location));
  const desiredVelocity = scale(direction, 2.2);
  const acceleration = scale(subtract(desiredVelocity, currentVelocity), 1 / 120);
  attempt(() => boss.applyImpulse(acceleration), "return Gauntlet toward home");
  debugMovement(boss.dimension, boss.location, direction, 5);
}

function solidAt(dimension, location) {
  if (!isLocationLoaded(dimension, location, 0.01)) return false;
  const block = attempt(() => dimension.getBlock(location), "inspect Gauntlet watchdog block");
  if (!block) return false;
  if (block.isAir === true || block.isLiquid === true) return false;
  return !["minecraft:air", "minecraft:cave_air", "minecraft:void_air"].includes(block.typeId);
}

function gauntletEmbedded(boss, height) {
  const base = boss.location;
  const centerSamples = [0.25, height * 0.5, Math.max(0.3, height - 0.15)];
  if (centerSamples.some((y) => solidAt(boss.dimension, { x: base.x, y: base.y + y, z: base.z }))) return true;
  const sideY = base.y + Math.min(height - 0.2, Math.max(0.4, height * 0.5));
  let blockedSides = 0;
  for (const [x, z] of [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) {
    if (solidAt(boss.dimension, { x: base.x + x, y: sideY, z: base.z + z })) blockedSides += 1;
  }
  return blockedSides >= 3;
}

function resetReturnWatchdog(state, now, homeDistance) {
  state.outOfBoundsSinceTick = undefined;
  state.lastHomeDistance = homeDistance;
  state.lastHomeProgressTick = now;
}

function watchdogReturnHome(boss, target, state, now) {
  const horizontal = horizontalDistance(boss.location, state.home);
  const vertical = Math.abs(boss.location.y - state.home.y);
  const outside = horizontal > GAUNTLET_LEASH_RADIUS || vertical > 14;
  const homeDistance = distance(boss.location, state.home);
  if (!outside) {
    resetReturnWatchdog(state, now, homeDistance);
    return false;
  }
  if (state.currentAttack) return false;

  if (state.outOfBoundsSinceTick === undefined) {
    state.outOfBoundsSinceTick = now;
    state.lastHomeDistance = homeDistance;
    state.lastHomeProgressTick = now;
  } else if (homeDistance < state.lastHomeDistance - 0.35) {
    state.lastHomeDistance = homeDistance;
    state.lastHomeProgressTick = now;
  }

  const range = dimensionHeightRange(boss.dimension);
  const physicalHeight = state.eyeOpen ? 4 : 2;
  const invalidHeight = boss.location.y < range.min + 0.05 || boss.location.y + physicalHeight >= range.max - 0.05;
  const embedded = gauntletEmbedded(boss, physicalHeight);
  const velocity = attempt(() => boss.getVelocity(), "read Gauntlet watchdog velocity") ?? { x: 0, y: 0, z: 0 };
  const nearlyStopped = Math.hypot(velocity.x, velocity.y, velocity.z) < 0.06;
  const stuck = nearlyStopped && now - state.lastHomeProgressTick >= 100;

  if (invalidHeight || embedded || stuck) {
    attempt(() => boss.teleport(state.home, { facingLocation: target.location }), "exceptional Gauntlet watchdog teleport");
    spawnGauntletBurst(boss.dimension, state.home, 30, 1.8, GAUNTLET_SMOKE_PARTICLE);
    state.pendingAttackId = undefined;
    state.nextAttackTick = now + 40;
    recordCombatEvent("gauntlet_watchdog_teleport", {
      bossId: boss.id,
      invalidHeight,
      embedded,
      stuck,
      outsideTicks: now - (state.outOfBoundsSinceTick ?? now)
    });
    resetReturnWatchdog(state, now, 0);
    return true;
  }

  setGauntletAnimation(boss, GAUNTLET_ANIMATION_STATE.idle);
  returnTowardHome(boss, state);
  state.nextAttackTick = Math.max(state.nextAttackTick, now + 10);
  return true;
}

function idleEffects(boss, state, now) {
  if (now - state.lastIdleParticleTick >= 8) {
    state.lastIdleParticleTick = now;
    spawnGauntletBurst(
      boss.dimension,
      { x: boss.location.x, y: boss.location.y + 1.5, z: boss.location.z },
      3,
      0.65,
      GAUNTLET_SPARK_PARTICLE
    );
  }
  if (now >= state.nextIdleSoundTick) {
    state.nextIdleSoundTick = now + 120 + Math.floor(Math.random() * 80);
    playGauntletSound(boss.dimension, "bomd.nether_gauntlet.idle", boss.location, 1.1, 1);
  }
}

function tickNeutralMovement(boss, target, state, now) {
  const point = targetCenter(target);
  const anchor = targetMovementAnchor(target);
  const steering = tickGauntletRoaming(boss, anchor, state.movement, now, {
    reactionDistance: 4,
    minRange: 5,
    maxRange: 25,
    maximumVelocity: 4.8,
    mass: GAUNTLET_BEDROCK_STEERING_MASS,
    maximumImpulse: 0.18,
    refreshTicks: 6,
    verticalAnchorY: anchor.y,
    verticalTolerance: GAUNTLET_VERTICAL_TOLERANCE,
    verticalCorrectionStrength: GAUNTLET_VERTICAL_CORRECTION_STRENGTH,
    bounds: { width: 2, height: state.eyeOpen ? 4 : 2 }
  });
  debugMovement(boss.dimension, boss.location, steering.direction, 5);
  smoothFace(boss, point, 16, 12);
}

function attackLaunchProfile(attackId) {
  if (attackId === "punch") {
    return { minRange: GAUNTLET_PUNCH_LAUNCH_MIN_RANGE, maxRange: GAUNTLET_PUNCH_LAUNCH_MAX_RANGE };
  }
  if (attackId === "swirl_punch") {
    return { minRange: GAUNTLET_SWIRL_LAUNCH_MIN_RANGE, maxRange: GAUNTLET_SWIRL_LAUNCH_MAX_RANGE };
  }
  return undefined;
}

function commitPendingAttack(boss, target, state, now) {
  const attack = chooseCommittedAttack(boss, state);
  state.pendingAttackId = attack.id;
  state.prepareStartTick = now;
  changePhase(boss, state, COMBAT_PHASE.prepare, "move_selected");
  recordCombatEvent("gauntlet_attack_selected", {
    bossId: boss.id,
    targetId: target.id,
    attack: attack.id,
    healthPercentage: healthRatio(boss),
    history: [...state.history]
  });
  return attack;
}

function tickAttackPreparation(boss, target, state, now) {
  const attack = ATTACKS.get(state.pendingAttackId) ?? normalPunch;
  if (attack.id === "laser" || attack.id === "blindness") {
    smoothFace(boss, targetCenter(target), 22, 16);
    return beginAttack(boss, target, state, attack, now);
  }

  const profile = attackLaunchProfile(attack.id);
  if (!profile) return beginAttack(boss, target, state, attack, now);
  const point = targetCenter(target);
  const movementPoint = { x: point.x, y: point.y - 1.0, z: point.z };
  smoothFace(boss, point, 45, 35);
  const launchDistance = distance({ x: boss.location.x, y: boss.location.y + 1, z: boss.location.z }, point);
  const pathClear = gauntletChargePathClear(boss, point, { width: 2, height: 2 });
  const facingError = gauntletFacingErrorDegrees(boss, point);
  const launchDirection = normalize(subtract(point, { x: boss.location.x, y: boss.location.y + 1, z: boss.location.z }));
  const launchVelocity = attempt(() => boss.getVelocity(), "read Gauntlet launch velocity") ?? { x: 0, y: 0, z: 0 };
  const forwardVelocity = launchVelocity.x * launchDirection.x + launchVelocity.y * launchDirection.y + launchVelocity.z * launchDirection.z;
  const inBand = launchDistance >= profile.minRange && launchDistance <= profile.maxRange;
  const timedOut = now - state.prepareStartTick >= GAUNTLET_ATTACK_PREPARE_TIMEOUT_TICKS;
  const fallbackReady = timedOut && pathClear &&
    launchDistance <= profile.maxRange + 4 && forwardVelocity >= 0.04;

  if ((inBand && pathClear && facingError <= 16 && forwardVelocity >= 0.10) || fallbackReady) {
    recordCombatEvent("gauntlet_attack_ready", {
      bossId: boss.id,
      attack: attack.id,
      targetId: target.id,
      launchDistance,
      facingError,
      pathClear,
      forwardVelocity,
      prepareTicks: now - state.prepareStartTick,
      fallbackReady
    });
    return beginAttack(boss, target, state, attack, now);
  }

  const steering = tickGauntletAttackPositioning(boss, movementPoint, state.movement, now, {
    minRange: profile.minRange,
    maxRange: profile.maxRange,
    maximumVelocity: 5.4,
    mass: 28,
    avoidanceMass: 40,
    holdMass: 4,
    launchForwardSpeed: GAUNTLET_LAUNCH_FORWARD_SPEED,
    maximumImpulse: 0.20,
    reactionDistance: 4,
    orbitWhenInBand: !pathClear,
    bounds: { width: 2, height: 4 }
  });
  debugMovement(boss.dimension, boss.location, steering.direction, 5);
  return false;
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
    beginRememberedBossDeath(boss, "Nether Gauntlet manager");
    return;
  }

  updateEyeVulnerability(boss, state);
  updateGauntletProxies(boss, state.eyeOpen);
  debugObbs(boss.dimension, gauntletObbs(boss, state.eyeOpen));
  idleEffects(boss, state, now);

  if (!state.engaged) {
    attempt(() => boss.clearVelocity(), "stop dormant Gauntlet");
    healIdle(boss);
    state.eyeOpen = true;
    setGauntletServerAttack(boss, "idle");
    setGauntletAnimation(boss, GAUNTLET_ANIMATION_STATE.idle);
    return;
  }

  const players = playersNear(boss);
  if (players.length === 0) {
    state.emptySinceTick ??= now;
    healIdle(boss);
    if (state.currentAttack) endAttack(boss, state, now, "target_lost");
    state.pendingAttackId = undefined;
    state.targetId = undefined;
    changePhase(boss, state, COMBAT_PHASE.reposition, "no_players");
    applyGauntletTravelDrag(boss, GAUNTLET_TRAVEL_DRAG);
    returnTowardHome(boss, state);
    return;
  }
  state.emptySinceTick = undefined;

  let target = chooseTarget(boss, players, state, now);
  if (!target) return;
  applyGauntletTravelDrag(boss, GAUNTLET_TRAVEL_DRAG);

  if (watchdogReturnHome(boss, target, state, now)) return;

  recordBossSample("nether_gauntlet", boss, {
    phase: state.phase,
    attack: state.currentAttack,
    pendingAttack: state.pendingAttackId,
    targetId: target.id,
    eyeOpen: state.eyeOpen,
    engaged: state.engaged,
    targetDistance: distance(boss.location, target.location),
    targetAnchorY: targetMovementAnchor(target).y,
    altitudeError: boss.location.y - targetMovementAnchor(target).y,
    blockedTicks: state.movement.blockedTicks,
    stagnantTicks: state.movement.stagnantTicks,
    attackTick: state.currentAttack ? Math.max(0, now - state.attackStartTick) : undefined,
    prepareTick: state.pendingAttackId ? Math.max(0, now - state.prepareStartTick) : undefined,
    chargePassedTarget: state.attackData?.chargePassedTarget,
    lockedTargetDistance: state.attackData?.targetPoint
      ? distance(boss.location, state.attackData.targetPoint)
      : undefined
  });

  if (state.currentAttack) {
    const attack = ATTACKS.get(state.currentAttack);
    const context = state.attackContext;
    const lockedTarget = context?.target;
    if (!context || !isEntityUsable(lockedTarget)) {
      endAttack(boss, state, now, "target_invalid");
      state.nextAttackTick = now + 20;
      return;
    }

    const localTick = Math.max(0, now - state.attackStartTick);
    // Java's CompositeGoal keeps movement active beside every attack. Punches
    // use locked charge support during wind-up/impact so they remain dodgeable,
    // then resume normal flight as soon as the fist reopens. Laser and cast keep
    // the normal movement goal for their full timelines.
    if (
      state.currentAttack === "laser" ||
      state.currentAttack === "blindness" ||
      state.attackData?.opened === true
    ) {
      tickNeutralMovement(boss, lockedTarget, state, now);
    }
    if (attack?.tick) runSafely(() => attack.tick(context, localTick), `tick hybrid Gauntlet ${state.currentAttack}`);
    if (now >= state.attackEndTick) endAttack(boss, state, now, "timeline_watchdog");
    return;
  }

  setGauntletAnimation(boss, GAUNTLET_ANIMATION_STATE.idle);

  if (now < state.nextAttackTick) {
    changePhase(boss, state, COMBAT_PHASE.reposition, "cooldown");
    tickNeutralMovement(boss, target, state, now);
    return;
  }

  if (!state.pendingAttackId) {
    target = chooseTarget(boss, players, state, now, true) ?? target;
    commitPendingAttack(boss, target, state, now);
  }

  if (!tickAttackPreparation(boss, target, state, now) && state.pendingAttackId) {
    changePhase(boss, state, COMBAT_PHASE.prepare, "positioning");
  }
}

function handleGauntletTimelineEvent(entity, message) {
  if (!isEntityUsable(entity) || entity.typeId !== GAUNTLET_TYPE) return;
  const separator = message.indexOf(":");
  const attackId = separator >= 0 ? message.slice(0, separator) : message;
  const pulse = separator >= 0 ? message.slice(separator + 1) : "";
  const state = stateByBossId.get(entity.id);
  if (!state || state.currentAttack !== attackId || !state.attackContext) {
    recordCombatEvent("gauntlet_timeline_stale", {
      bossId: entity.id,
      message,
      currentAttack: state?.currentAttack
    });
    return;
  }
  if (pulse === "complete") {
    endAttack(entity, state, system.currentTick, "behavior_timeline_complete");
    return;
  }
  const attack = ATTACKS.get(attackId);
  if (attack?.pulse) {
    runSafely(
      () => attack.pulse(state.attackContext, pulse),
      `Gauntlet behavior pulse ${message}`
    );
  }
  updateEyeVulnerability(entity, state);
  recordCombatEvent("gauntlet_timeline_pulse", {
    bossId: entity.id,
    attack: attackId,
    pulse
  });
}

function damagingPlayer(source) {
  const direct = source.damagingEntity;
  if (isEntityUsable(direct) && direct.typeId === "minecraft:player") return direct;

  const projectile = source.damagingProjectile;
  const owner = attempt(
    () => projectile?.getComponent("minecraft:projectile")?.owner,
    "resolve Gauntlet projectile owner"
  );
  return isEntityUsable(owner) && owner.typeId === "minecraft:player" ? owner : undefined;
}

function isBypassDamage(source) {
  return BYPASS_DAMAGE_CAUSES.has(String(source.cause));
}

function isExplosionDamage(source) {
  const cause = String(source.cause);
  return cause === "entityExplosion" || cause === "blockExplosion";
}

function entityHeadLocation(entity) {
  return (
    attempt(() => entity.getHeadLocation(), "read attacker head location") ?? {
      x: entity.location.x,
      y: entity.location.y + 1.5,
      z: entity.location.z
    }
  );
}

function explosionOrigin(boss, source, now) {
  const attacker = source.damagingEntity;
  const sourceId = isEntityUsable(attacker) ? attacker.id : undefined;
  return recentExplosionOrigin(boss.dimension, gauntletEyeCenter(boss), now, sourceId, 24) ??
    (isEntityUsable(attacker)
      ? { x: attacker.location.x, y: attacker.location.y + 0.5, z: attacker.location.z }
      : undefined);
}

function explosionBehindGauntlet(boss, origin) {
  const forward = attempt(() => boss.getViewDirection(), "read Gauntlet explosion facing");
  if (!forward) return false;
  const relative = normalize(subtract(origin, gauntletEyeCenter(boss)));
  return forward.x * relative.x + forward.y * relative.y + forward.z * relative.z < -0.15;
}

function firstDamagePart(boss, source, eyeOpen) {
  const projectile = source.damagingProjectile;
  if (isEntityUsable(projectile)) {
    const history = projectileSegment(projectile);
    const liveLocation = { ...projectile.location };
    if (history) {
      // The cached current location belongs to the previous manager tick. Use
      // the live impact location as the segment end or a fast arrow can cross
      // the thin eye between samples and be rejected.
      const hit = firstGauntletSegmentPart(
        boss,
        eyeOpen,
        history.previousLocation,
        liveLocation,
        0.12
      );
      if (hit) return hit.box.id;
    }
    const velocity = attempt(() => projectile.getVelocity(), "read projectile velocity");
    if (velocity && Math.hypot(velocity.x, velocity.y, velocity.z) > 0.001) {
      const previous = subtract(liveLocation, scale(velocity, 2.25));
      const future = {
        x: liveLocation.x + velocity.x * 0.75,
        y: liveLocation.y + velocity.y * 0.75,
        z: liveLocation.z + velocity.z * 0.75
      };
      const hit = firstGauntletSegmentPart(boss, eyeOpen, previous, future, 0.12);
      if (hit) return hit.box.id;
    }
    return undefined;
  }

  const attacker = source.damagingEntity;
  if (isExplosionDamage(source)) {
    const origin = explosionOrigin(boss, source, system.currentTick);
    if (!origin) return undefined;
    if (eyeOpen && explosionBehindGauntlet(boss, origin)) return GAUNTLET_PART.EYE;
    return firstGauntletSegmentPart(boss, eyeOpen, origin, gauntletEyeCenter(boss), 0.09)?.box.id;
  }
  if (!isEntityUsable(attacker)) return undefined;
  const direction = attempt(() => attacker.getViewDirection(), "read attacker view direction");
  if (!direction) return undefined;
  return firstGauntletRayPart(
    boss,
    eyeOpen,
    entityHeadLocation(attacker),
    direction,
    GAUNTLET_MELEE_RAY_LENGTH,
    0.09
  )?.box.id;
}

function ordinaryDamageHitsEye(boss, source, eyeOpen) {
  return firstDamagePart(boss, source, eyeOpen) === GAUNTLET_PART.EYE;
}

function queueDeflectionFeedback(boss, source, eye, now) {
  const previous = lastDeflectTickByBossId.get(boss.id) ?? -100;
  if (now - previous < 8) return;
  lastDeflectTickByBossId.set(boss.id, now);
  const player = damagingPlayer(source);
  const meleePlayer =
    !isEntityUsable(source.damagingProjectile) &&
    isEntityUsable(source.damagingEntity) &&
    source.damagingEntity.typeId === "minecraft:player"
      ? source.damagingEntity
      : undefined;

  system.run(() => {
    if (!isEntityUsable(boss)) return;
    playGauntletSound(boss.dimension, "random.anvil_land", eye, 0.7, 1.65);
    for (let index = 0; index < 7; index += 1) {
      const angle = (Math.PI * 2 * index) / 7;
      spawnGauntletParticle(boss.dimension, GAUNTLET_SPARK_PARTICLE, {
        x: eye.x + Math.cos(angle) * 0.28,
        y: eye.y + ((index % 3) - 1) * 0.12,
        z: eye.z + Math.sin(angle) * 0.28
      });
    }
    if (!isEntityUsable(player)) return;
    const lastHint = lastEyeHintTickByPlayerId.get(player.id) ?? -999;
    if (now - lastHint >= 100) {
      lastEyeHintTickByPlayerId.set(player.id, now);
      attempt(
        () => player.onScreenDisplay.setActionBar(translate("bomd.message.gauntlet.eye_hint")),
        "show Gauntlet eye hint"
      );
    }
    if (isEntityUsable(meleePlayer) && distance(meleePlayer.location, boss.location) <= 8) {
      const away = normalize(subtract(meleePlayer.location, boss.location));
      attempt(
        () => meleePlayer.applyKnockback({ x: away.x * 0.75, z: away.z * 0.75 }, 0.12),
        "deflect melee attacker"
      );
    }
  });
}

function applyJavaDamageScaling(event, state) {
  const armor = state?.engaged ? GAUNTLET_COMBAT_ARMOR : GAUNTLET_DORMANT_ARMOR;
  event.damage = Math.max(0.1, damageAfterJavaArmor(event.damage, armor));
  event.damage = scaleDamageToBoss(event.damage);
}

function damageSourceKey(source) {
  if (isEntityUsable(source.damagingProjectile)) return `projectile:${source.damagingProjectile.id}`;
  if (isEntityUsable(source.damagingEntity)) return `entity:${source.damagingEntity.id}`;
  return `cause:${String(source.cause)}`;
}

function reserveHit(boss, source, now) {
  const key = `${boss.id}|${damageSourceKey(source)}`;
  if ((acceptedHitTickByKey.get(key) ?? -999) === now) return false;
  acceptedHitTickByKey.set(key, now);
  return true;
}

function filterGauntletDamage(event) {
  const boss = event.hurtEntity;
  if (boss.typeId !== GAUNTLET_TYPE || isBypassDamage(event.damageSource)) return;
  const manual = manualProxyDamageByBossId.get(boss.id) ?? 0;
  const state = stateByBossId.get(boss.id);
  if (manual > 0) {
    manualProxyDamageByBossId.set(boss.id, manual - 1);
    applyJavaDamageScaling(event, state);
    return;
  }

  const now = system.currentTick;
  const eyeOpen = currentEyeOpen(boss, state);
  const eye = gauntletEyeCenter(boss);
  const eyeHit = eyeOpen && ordinaryDamageHitsEye(boss, event.damageSource, eyeOpen);
  if (!eyeHit) {
    event.cancel = true;
    queueDeflectionFeedback(boss, event.damageSource, eye, now);
    return;
  }
  if (!reserveHit(boss, event.damageSource, now)) {
    event.cancel = true;
    return;
  }
  applyJavaDamageScaling(event, state);
}

function forwardProxyDamage(event) {
  const proxy = event.hurtEntity;
  if (proxy.typeId !== GAUNTLET_PROXY_TYPE) return false;
  event.cancel = true;
  const parentId = proxyParentId(proxy);
  const boss = parentId ? trackedBosses.get(parentId) : undefined;
  if (!isEntityUsable(boss)) return true;
  const now = system.currentTick;
  const state = stateByBossId.get(boss.id);
  const eyeOpen = currentEyeOpen(boss, state);
  const eye = gauntletEyeCenter(boss);
  const struckPart = proxyPart(proxy);
  // The eye proxy itself is the authoritative contact result. Re-running the
  // projectile geometry after Bedrock has already resolved the impact used a
  // stale/removed arrow and rejected valid shots.
  if (!eyeOpen || struckPart !== GAUNTLET_PART.EYE) {
    queueDeflectionFeedback(boss, event.damageSource, eye, now);
    return true;
  }
  if (!reserveHit(boss, event.damageSource, now)) return true;
  const player = damagingPlayer(event.damageSource);
  const projectile = event.damageSource.damagingProjectile;
  const projectileOwner = attempt(
    () => projectile?.getComponent("minecraft:projectile")?.owner,
    "snapshot Gauntlet projectile owner"
  );
  const damage = event.damage;
  recordCombatEvent("gauntlet_eye_proxy_hit", {
    bossId: boss.id,
    playerId: player?.id,
    projectileId: isEntityUsable(projectile) ? projectile.id : undefined,
    damage
  });
  system.run(() => {
    if (!isEntityUsable(boss)) return;
    manualProxyDamageByBossId.set(
      boss.id,
      (manualProxyDamageByBossId.get(boss.id) ?? 0) + 1
    );
    const owner = isEntityUsable(projectileOwner)
      ? projectileOwner
      : (isEntityUsable(player) ? player : undefined);
    // The proxy event has already established that the projectile contacted
    // the open eye and `event.damage` already contains the projectile's final
    // damage. Reusing the projectile entity on the following tick is unsafe:
    // arrows are often removed or changed to an unsupported state by Bedrock.
    // Forward the computed amount as attributed generic damage instead.
    const applied = attempt(
      () => boss.applyDamage(damage, {
        cause: isEntityUsable(owner) ? EntityDamageCause.entityAttack : EntityDamageCause.magic,
        ...(isEntityUsable(owner) ? { damagingEntity: owner } : {})
      }),
      "forward authoritative Gauntlet eye damage"
    );
    if (applied !== true) {
      manualProxyDamageByBossId.set(
        boss.id,
        Math.max(0, (manualProxyDamageByBossId.get(boss.id) ?? 1) - 1)
      );
    }
  });
  return true;
}

function rememberDamage(event) {
  const boss = event.hurtEntity;
  if (boss.typeId !== GAUNTLET_TYPE) return;

  const now = system.currentTick;
  const state = stateByBossId.get(boss.id) ?? initializeBoss(boss, now);
  const player = damagingPlayer(event.damageSource);
  const attacker = player ?? event.damageSource.damagingEntity;
  if (!isEntityUsable(attacker)) return;
  const firstEngagement = state.engaged !== true;
  state.engaged = true;
  state.emptySinceTick = undefined;
  if (firstEngagement) {
    state.aggroTick = now;
    // Do not convert the successful wake-up hit into a near-immediate punch.
    // The boss first acquires the target and begins moving, then enters the
    // normal attack cadence after the full initial cooldown.
    state.nextAttackTick = now + GAUNTLET_INITIAL_ATTACK_DELAY_TICKS;
    state.targetId = player?.id ?? state.targetId;
    if (player) {
      const anchor = targetMovementAnchor(player);
      state.movement.direction = normalize(subtract(anchor, boss.location));
      state.movement.directionUntilTick = now + 8;
    }
    attempt(() => boss.clearVelocity(), "reset Gauntlet wake-up velocity");
    changePhase(boss, state, COMBAT_PHASE.reposition, "aggro");
    setGauntletAnimation(boss, GAUNTLET_ANIMATION_STATE.idle);
    setGauntletEyeOpen(boss, true);
    state.eyeOpen = true;
    recordCombatEvent("gauntlet_engaged", {
      bossId: boss.id,
      playerId: player?.id,
      firstAttackTick: state.nextAttackTick
    });
  }

  if (player) {
    state.damageMemory = appendDamageMemory(state.damageMemory, {
      playerId: player.id,
      damage: Math.max(0, event.damage ?? 0),
      tick: now
    });
    // Damage memory influences the next Java move selection. Do not redirect a
    // committed attack in mid-animation when another player lands a hit.
    if (firstEngagement) state.targetId = player.id;
  }
  if (now - state.lastHurtSoundTick >= 10) {
    state.lastHurtSoundTick = now;
    playGauntletSound(boss.dimension, "bomd.nether_gauntlet.hurt", boss.location, 1.1, 1);
  }
}

function discoverBosses(now) {
  lastDiscoveryTick = now;
  for (const dimensionId of ["overworld", "nether", "the_end"]) {
    attempt(() => {
      const dimension = world.getDimension(dimensionId);
      if (!purgedLoadedProxies) {
        for (const proxy of dimension.getEntities({ type: GAUNTLET_PROXY_TYPE })) {
          attempt(() => proxy.remove(), "remove stale loaded Gauntlet proxy");
        }
      }
      for (const boss of dimension.getEntities({ type: GAUNTLET_TYPE })) {
        trackedBosses.set(boss.id, boss);
        if (!stateByBossId.has(boss.id)) initializeBoss(boss, now);
      }
    }, `discover ${dimensionId} Gauntlets`);
  }
  purgedLoadedProxies = true;
}

function managerTick() {
  const now = system.currentTick;
  if (now - lastDiscoveryTick >= 40) {
    discoverBosses(now);
  }
  for (const [id, boss] of trackedBosses) {
    if (!isEntityUsable(boss)) {
      trackedBosses.delete(id);
      stateByBossId.delete(id);
      lastDeflectTickByBossId.delete(id);
      removeGauntletProxies(id);
      continue;
    }
    tickBoss(boss, now);
  }
  cleanupInvalidGauntletProxies(new Set(trackedBosses.keys()));
  for (const [key, tick] of acceptedHitTickByKey) {
    if (now - tick > 2) acceptedHitTickByKey.delete(key);
  }
}

export function startNetherGauntletManager() {
  if (started) return;
  started = true;
  setGauntletTimelineHandler(handleGauntletTimelineEvent);
  world.afterEvents.entitySpawn.subscribe((event) => {
    if (event.entity.typeId !== GAUNTLET_TYPE) return;
    trackedBosses.set(event.entity.id, event.entity);
    system.run(() => {
      if (isEntityUsable(event.entity) && !stateByBossId.has(event.entity.id)) {
        initializeBoss(event.entity, system.currentTick);
      }
    });
  });
  world.beforeEvents.entityHurt.subscribe((event) => {
    try {
      if (forwardProxyDamage(event)) return;
      filterGauntletDamage(event);
    } catch (error) {
      console.warn(`[BOMD] filter Gauntlet damage failed: ${String(error)}`);
    }
  });
  world.afterEvents.entityHurt.subscribe((event) =>
    attempt(() => rememberDamage(event), "remember Gauntlet damage")
  );
  system.runInterval(managerTick, GAUNTLET_MANAGER_INTERVAL_TICKS);
}
