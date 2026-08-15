// @ts-check

import {
  EntityDamageCause,
  system,
  world
} from "@minecraft/server";
import { blindnessCast } from "../attacks/gauntlet/blindness.js";
import { gauntletLaser } from "../attacks/gauntlet/laser.js";
import { normalPunch } from "../attacks/gauntlet/normal_punch.js";
import { spinPunch } from "../attacks/gauntlet/spin_punch.js";
import {
  combatPlayers,
  gauntletArmorValue,
  knockPlayer,
  probeGauntletPath,
  setGauntletDashPhysics,
  setGauntletDesiredVelocity,
  setGauntletAnimation,
  setGauntletCombatArmor,
  setGauntletEnergy,
  setGauntletEyeOpen,
  setGauntletHandClosed,
  targetCenter
} from "../attacks/gauntlet/shared.js";
import { damageAfterJavaArmor } from "../core/armor.js";
import {
  isBossCombatPlayer,
  markBossAggressor
} from "../core/combat_target.js";
import {
  GAUNTLET_ANIMATION_STATE,
  GAUNTLET_ATTACK_HISTORY_PROPERTY,
  GAUNTLET_AWAKE_PROPERTY,
  GAUNTLET_BALANCE_VERSION_PROPERTY,
  GAUNTLET_COMBAT_RADIUS,
  GAUNTLET_DEATH_END_TICK_PROPERTY,
  GAUNTLET_DEATH_TICKS,
  GAUNTLET_DYING_PROPERTY,
  GAUNTLET_ENERGY_PARTICLE,
  GAUNTLET_EYE_OPEN_PROPERTY,
  GAUNTLET_HOME_X_PROPERTY,
  GAUNTLET_HOME_Y_PROPERTY,
  GAUNTLET_HOME_Z_PROPERTY,
  GAUNTLET_IDLE_HEAL_PER_TICK,
  GAUNTLET_LEASH_RADIUS,
  GAUNTLET_PREVIOUS_ATTACK_PROPERTY,
  GAUNTLET_RESET_DELAY_TICKS,
  GAUNTLET_SCALED_PLAYERS_PROPERTY,
  GAUNTLET_TYPE
} from "../core/config.js";
import {
  appendGauntletAttackHistory,
  clampGauntletPlayerCount,
  explosionApproachesGauntletRear,
  firstGauntletPartHit,
  gauntletAttackWeights,
} from "../core/gauntlet_logic.js";
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
  normalize,
  scale,
  subtract
} from "../core/vector.js";
import {
  playSound,
  spawnParticle
} from "../visuals/frost.js";
import {
  gauntletEyeOrigin,
  removeGauntletBeamEntity
} from "../visuals/gauntlet.js";

const BALANCE_VERSION = 3;
const RECOVERY_SCAN_TICKS = 200;
const BYPASS_DAMAGE_CAUSES = new Set([
  EntityDamageCause.selfDestruct,
  EntityDamageCause.override,
  EntityDamageCause.void
]);
const stateByBossId = new Map();
const projectilePathById = new Map();
const pendingAwakenAttackerByBossId = new Map();
let started = false;

function readNumberProperty(entity, propertyId) {
  const value = attempt(
    () => entity.getDynamicProperty(propertyId),
    `read ${propertyId}`
  );
  return typeof value === "number" ? value : undefined;
}

function readStringArrayProperty(entity, propertyId) {
  const value = attempt(
    () => entity.getDynamicProperty(propertyId),
    `read ${propertyId}`
  );
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry) => typeof entry === "string").slice(-4)
      : [];
  } catch {
    return [];
  }
}

function writeAttackHistory(boss, history) {
  boss.setDynamicProperty(
    GAUNTLET_ATTACK_HISTORY_PROPERTY,
    history.length > 0 ? JSON.stringify(history.slice(-4)) : undefined
  );
}

function readHome(boss) {
  const x = readNumberProperty(boss, GAUNTLET_HOME_X_PROPERTY);
  const y = readNumberProperty(boss, GAUNTLET_HOME_Y_PROPERTY);
  const z = readNumberProperty(boss, GAUNTLET_HOME_Z_PROPERTY);
  if (x !== undefined && y !== undefined && z !== undefined) {
    return { x, y, z };
  }

  const home = { ...boss.location };
  boss.setDynamicProperty(GAUNTLET_HOME_X_PROPERTY, home.x);
  boss.setDynamicProperty(GAUNTLET_HOME_Y_PROPERTY, home.y);
  boss.setDynamicProperty(GAUNTLET_HOME_Z_PROPERTY, home.z);
  return home;
}

function applyMultiplayerScale(boss, state, requestedCount) {
  const playerCount = effectiveEncounterPlayers(
    clampGauntletPlayerCount(requestedCount)
  );
  const oldHealth = boss.getComponent("minecraft:health");
  const oldRatio = oldHealth
    ? oldHealth.currentValue / Math.max(1, oldHealth.effectiveMax)
    : 1;
  const storedVersion = readNumberProperty(
    boss,
    GAUNTLET_BALANCE_VERSION_PROPERTY
  );
  const storedCount = readNumberProperty(
    boss,
    GAUNTLET_SCALED_PLAYERS_PROPERTY
  );

  state.playerCount = playerCount;
  const activeBalanceRevision = balanceRevision(BALANCE_VERSION);
  if (
    storedVersion === activeBalanceRevision &&
    storedCount === playerCount
  ) {
    return;
  }
  boss.triggerEvent(`bomd:scale_${playerCount}`);
  boss.setDynamicProperty(
    GAUNTLET_SCALED_PLAYERS_PROPERTY,
    playerCount
  );
  boss.setDynamicProperty(
    GAUNTLET_BALANCE_VERSION_PROPERTY,
    activeBalanceRevision
  );
  system.runTimeout(() => {
    if (!isEntityUsable(boss)) {
      return;
    }
    const scaledHealth = boss.getComponent("minecraft:health");
    if (!scaledHealth) {
      return;
    }
    scaledHealth.setCurrentValue(
      Math.max(
        1,
        Math.min(
          scaledHealth.effectiveMax,
          scaledHealth.effectiveMax * oldRatio
        )
      )
    );
  }, 1);
}

function initializeGauntlet(boss, now) {
  const awake =
    attempt(
      () => boss.getDynamicProperty(GAUNTLET_AWAKE_PROPERTY),
      "read Nether Gauntlet awake state"
    ) === true;
  const previousAttack = attempt(
    () => boss.getDynamicProperty(GAUNTLET_PREVIOUS_ATTACK_PROPERTY),
    "read Nether Gauntlet previous attack"
  );
  const dying =
    attempt(
      () => boss.getDynamicProperty(GAUNTLET_DYING_PROPERTY),
      "read Nether Gauntlet death state"
    ) === true;
  const deathEndTick = readNumberProperty(
    boss,
    GAUNTLET_DEATH_END_TICK_PROPERTY
  );
  const storedPlayers = readNumberProperty(
    boss,
    GAUNTLET_SCALED_PLAYERS_PROPERTY
  );

  boss.nameTag = "Nether Gauntlet";
  setGauntletAnimation(
    boss,
    dying
      ? GAUNTLET_ANIMATION_STATE.death
      : awake
        ? GAUNTLET_ANIMATION_STATE.idle
        : GAUNTLET_ANIMATION_STATE.dormant
  );
  setGauntletEnergy(boss, dying ? 2 : 0);
  setGauntletEyeOpen(boss, awake && !dying);
  setGauntletHandClosed(boss, dying);
  setGauntletCombatArmor(boss, false);
  attempt(
    () => boss.setProperty("bomd:gauntlet_hurt", 0),
    "reset Nether Gauntlet hurt texture"
  );

  const state = {
    home: readHome(boss),
    awake,
    dying,
    finalizingDeath: false,
    deathEndTick:
      dying && deathEndTick !== undefined ? deathEndTick : now + 50,
    playerCount: clampGauntletPlayerCount(storedPlayers ?? 1),
    targetId: /** @type {string | undefined} */ (undefined),
    currentAttack: /** @type {any} */ (undefined),
    attackTargetId: /** @type {string | undefined} */ (undefined),
    attackStartTick: now,
    attackEndTick: now,
    attackData: /** @type {any} */ ({}),
    nextAttackTick: now + 60,
    previousAttack:
      typeof previousAttack === "string" ? previousAttack : undefined,
    attackHistory: readStringArrayProperty(
      boss,
      GAUNTLET_ATTACK_HISTORY_PROPERTY
    ),
    emptySinceTick: /** @type {number | undefined} */ (undefined),
    lastIdleParticleTick: now,
    lastTargetDecisionTick: now,
    movementWaypoint: undefined,
    movementWaypointUntil: now,
    movementSampleLocation: { ...boss.location },
    movementSampleTick: now,
    movementStallScore: 0,
    movementCommandSpeed: 0,
    escapeDirection: undefined,
    escapeUntilTick: now,
    orbitSign: Math.random() < 0.5 ? -1 : 1,
    lastDeflectTick: now - 20,
    hurtSerial: 0,
    damageMemory:
      /** @type {{ playerId: string, damage: number, tick: number }[]} */ (
        []
      )
  };
  stateByBossId.set(boss.id, state);

  if (awake) {
    const players = combatPlayers(
      boss.dimension,
      boss.location,
      GAUNTLET_COMBAT_RADIUS
    );
    applyMultiplayerScale(
      boss,
      state,
      storedPlayers ?? players.length
    );
  }
  return state;
}

function nearestPlayer(boss, players) {
  return [...players].sort(
    (left, right) =>
      distance(boss.location, left.location) -
      distance(boss.location, right.location)
  )[0];
}

function currentTarget(boss, players, state, now) {
  const stored = players.find((player) => player.id === state.targetId);
  if (
    stored &&
    now - state.lastTargetDecisionTick < 20
  ) {
    return stored;
  }
  state.lastTargetDecisionTick = now;
  state.damageMemory = state.damageMemory.filter(
    (entry) => now - entry.tick <= 600
  );

  let chosen = stored;
  if (state.damageMemory.length > 0 && Math.random() < 0.5) {
    const totals = new Map();
    for (const entry of state.damageMemory) {
      if (!players.some((player) => player.id === entry.playerId)) {
        continue;
      }
      totals.set(
        entry.playerId,
        (totals.get(entry.playerId) ?? 0) + entry.damage
      );
    }
    const attackerId = [...totals.entries()].sort(
      (left, right) => right[1] - left[1]
    )[0]?.[0];
    chosen = players.find((player) => player.id === attackerId);
  }
  chosen ??= nearestPlayer(boss, players);
  state.targetId = chosen?.id;
  return chosen;
}

function chooseWeighted(entries) {
  const total = entries.reduce(
    (sum, entry) => sum + Math.max(0, entry.weight),
    0
  );
  if (total <= 0) {
    return normalPunch;
  }
  let cursor = Math.random() * total;
  for (const entry of entries) {
    cursor -= Math.max(0, entry.weight);
    if (cursor <= 0) {
      return entry.attack;
    }
  }
  return entries[entries.length - 1].attack;
}

function selectAttack(boss, target, state) {
  const health = boss.getComponent("minecraft:health");
  const healthRatio = health
    ? health.currentValue / Math.max(1, health.effectiveMax)
    : 1;
  const weights = gauntletAttackWeights({
    healthRatio,
    previousAttack: state.previousAttack,
    attackHistory: state.attackHistory
  });
  const targetDistance = distance(
    { x: boss.location.x, y: boss.location.y + 1.2, z: boss.location.z },
    { x: target.location.x, y: target.location.y + 0.9, z: target.location.z }
  );

  // Bedrock-native pacing: never begin a melee commitment from so far away
  // that its animation/timeout can expire before the hand reaches the player.
  // At long range the boss closes distance; when laser is unlocked it may use
  // that instead. This produces pressure without fake speed spikes.
  if (targetDistance > 22) {
    if (weights.laser > 0 && state.previousAttack !== "laser") {
      return gauntletLaser;
    }
    return undefined;
  }

  let punchWeight = weights.punch;
  let spinWeight = weights.spin;
  let laserWeight = weights.laser;
  if (targetDistance > 16) {
    punchWeight *= 0.35;
    spinWeight = 0;
    laserWeight *= 1.65;
  } else if (targetDistance < 7) {
    spinWeight *= 1.35;
    laserWeight *= 0.75;
  }

  return chooseWeighted([
    { attack: normalPunch, weight: punchWeight },
    { attack: gauntletLaser, weight: laserWeight },
    { attack: spinPunch, weight: spinWeight },
    { attack: blindnessCast, weight: weights.blindness }
  ]);
}

function attackContext(boss, target, state, now) {
  return {
    boss,
    target,
    state,
    now,
    elapsed: now - state.attackStartTick
  };
}

function finishAttack(boss, target, state, now, cancelled = false) {
  const attack = state.currentAttack;
  if (attack) {
    runSafely(
      () => attack.finish(attackContext(boss, target, state, now)),
      `finish Nether Gauntlet ${attack.id}`
    );
  }
  state.currentAttack = undefined;
  state.attackTargetId = undefined;
  state.attackData = {};
  state.nextAttackTick = cancelled
    ? now + 30
    : now + (attack?.recovery ?? 24);
}

function beginAttack(boss, target, state, attack, now) {
  state.currentAttack = attack;
  state.attackTargetId = target.id;
  state.attackStartTick = now;
  state.attackEndTick = now + attack.duration;
  state.attackData = {};

  const succeeded = runSafely(
    () => attack.start(attackContext(boss, target, state, now)),
    `start Nether Gauntlet ${attack.id}`
  );
  if (!succeeded) {
    finishAttack(boss, target, state, now, true);
    return;
  }
  state.previousAttack = attack.id;
  state.attackHistory = appendGauntletAttackHistory(
    state.attackHistory,
    attack.id
  );
  boss.setDynamicProperty(
    GAUNTLET_PREVIOUS_ATTACK_PROPERTY,
    attack.id
  );
  writeAttackHistory(boss, state.attackHistory);
}

function rotateHorizontal(vector, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: vector.x * cosine - vector.z * sine,
    y: vector.y,
    z: vector.x * sine + vector.z * cosine
  };
}

function movementHealthMultiplier(boss) {
  const health = boss.getComponent("minecraft:health");
  if (!health) return 1;
  const ratio = health.currentValue / Math.max(1, health.effectiveMax);
  if (ratio <= 0.25) return 1.14;
  if (ratio <= 0.5) return 1.08;
  return 1;
}

function chooseTacticalWaypoint(boss, target, state, now) {
  const targetPoint = {
    x: target.location.x,
    y: target.location.y + 0.9,
    z: target.location.z
  };
  let radial = normalize({
    x: boss.location.x - targetPoint.x,
    y: 0,
    z: boss.location.z - targetPoint.z
  });
  if (Math.abs(radial.x) + Math.abs(radial.z) < 0.01) {
    radial = { x: 1, y: 0, z: 0 };
  }
  const directionOrder = [42, 72, 105, -48, -82, 145, 180, 15];
  const radii = [9, 11, 8, 12, 10, 13, 9, 7.5];
  const heights = [2.8, 4.0, 2.0, 3.3, 1.5, 4.6, 2.4, 3.6];
  const sign = state.orbitSign ?? 1;
  for (let index = 0; index < directionOrder.length; index += 1) {
    const around = rotateHorizontal(radial, directionOrder[index] * sign);
    const candidate = {
      x: targetPoint.x + around.x * radii[index],
      y: target.location.y + heights[index],
      z: targetPoint.z + around.z * radii[index]
    };
    const toCandidate = subtract(candidate, boss.location);
    const probeDistance = Math.min(4.2, Math.max(1.5, distance(candidate, boss.location)));
    if (probeGauntletPath(boss, toCandidate, probeDistance)) {
      state.movementWaypoint = candidate;
      state.movementWaypointUntil = now + 18 + Math.floor(Math.random() * 9);
      if (Math.random() < 0.14) state.orbitSign *= -1;
      return candidate;
    }
  }

  // If every orbit candidate is blocked, prefer moving upward and away from
  // the target. Bedrock arenas often have low ledges that trap a 4-block-tall
  // collision box even when the horizontal ray appears open.
  const fallbackDirections = [
    { x: radial.x, y: 0.55, z: radial.z },
    { x: -radial.z, y: 0.45, z: radial.x },
    { x: radial.z, y: 0.45, z: -radial.x },
    { x: 0, y: 1, z: 0 }
  ];
  for (const candidateDirection of fallbackDirections) {
    if (!probeGauntletPath(boss, candidateDirection, 3.2)) continue;
    const direction = normalize(candidateDirection);
    const candidate = {
      x: boss.location.x + direction.x * 5,
      y: boss.location.y + direction.y * 5,
      z: boss.location.z + direction.z * 5
    };
    state.movementWaypoint = candidate;
    state.movementWaypointUntil = now + 12;
    return candidate;
  }

  state.movementWaypoint = { ...boss.location };
  state.movementWaypointUntil = now + 6;
  return state.movementWaypoint;
}

function chooseEscapeDirection(boss, target) {
  const targetPoint = { x: target.location.x, y: target.location.y + 0.9, z: target.location.z };
  let away = normalize({
    x: boss.location.x - targetPoint.x,
    y: 0.2,
    z: boss.location.z - targetPoint.z
  });
  const angles = [0, 45, -45, 90, -90, 135, -135, 180];
  for (const vertical of [0.45, 0.15, -0.25, 0.7]) {
    for (const angle of angles) {
      const rotated = rotateHorizontal(away, angle);
      const candidate = normalize({ x: rotated.x, y: vertical, z: rotated.z });
      if (probeGauntletPath(boss, candidate, 3.4)) return candidate;
    }
  }
  return { x: 0, y: 1, z: 0 };
}

function updateMovementStall(boss, target, state, now) {
  if (now - state.movementSampleTick < 8) return;
  const moved = distance(boss.location, state.movementSampleLocation);
  if ((state.movementCommandSpeed ?? 0) > 0.14 && moved < 0.16) {
    state.movementStallScore = (state.movementStallScore ?? 0) + 1;
  } else {
    state.movementStallScore = Math.max(0, (state.movementStallScore ?? 0) - 1);
  }
  state.movementSampleLocation = { ...boss.location };
  state.movementSampleTick = now;
  if (state.movementStallScore < 2) return;

  state.movementStallScore = 0;
  state.escapeDirection = chooseEscapeDirection(boss, target);
  state.escapeUntilTick = now + 12;
  state.movementWaypointUntil = now;
  attempt(() => boss.clearVelocity(), "unstick Nether Gauntlet movement");
}

function steerGauntlet(boss, target, state, now, speedScale = 1) {
  updateMovementStall(boss, target, state, now);

  if (now < (state.escapeUntilTick ?? 0) && state.escapeDirection) {
    const escapeSpeed = 0.34 * movementHealthMultiplier(boss) * speedScale;
    state.movementCommandSpeed = escapeSpeed;
    setGauntletDesiredVelocity(boss, scale(state.escapeDirection, escapeSpeed), 0.42);
    return;
  }

  const waypointInvalid =
    !state.movementWaypoint ||
    now >= (state.movementWaypointUntil ?? 0) ||
    distance(boss.location, state.movementWaypoint) < 1.8;
  if (waypointInvalid) chooseTacticalWaypoint(boss, target, state, now);

  let toWaypoint = subtract(state.movementWaypoint, boss.location);
  if (!probeGauntletPath(boss, toWaypoint, Math.min(2.5, Math.max(1.2, distance(boss.location, state.movementWaypoint))))) {
    chooseTacticalWaypoint(boss, target, state, now);
    toWaypoint = subtract(state.movementWaypoint, boss.location);
  }

  const targetDistance = distance(
    { x: boss.location.x, y: boss.location.y + 1.2, z: boss.location.z },
    { x: target.location.x, y: target.location.y + 0.9, z: target.location.z }
  );
  let speed = targetDistance > 20 ? 0.34 : targetDistance > 14 ? 0.29 : 0.23;
  if (distance(boss.location, state.movementWaypoint) < 3.5) speed *= 0.62;
  speed *= movementHealthMultiplier(boss) * speedScale;

  const direction = normalize(toWaypoint);
  const desiredVelocity = scale(direction, speed);
  desiredVelocity.y = Math.max(-0.18, Math.min(0.18, desiredVelocity.y));
  state.movementCommandSpeed = speed;
  setGauntletDesiredVelocity(boss, desiredVelocity, 0.24);
}

function idleHeal(boss) {
  const health = boss.getComponent("minecraft:health");
  if (!health || health.currentValue >= health.effectiveMax) {
    return;
  }
  health.setCurrentValue(
    Math.min(
      health.effectiveMax,
      health.currentValue + GAUNTLET_IDLE_HEAL_PER_TICK
    )
  );
}

function resetGauntlet(boss, state, now) {
  const target =
    combatPlayers(boss.dimension, boss.location, GAUNTLET_COMBAT_RADIUS)[0];
  if (state.currentAttack) {
    finishAttack(boss, target, state, now, true);
  }
  attempt(
    () => boss.teleport(state.home),
    "return Nether Gauntlet home"
  );
  boss.getComponent("minecraft:health")?.resetToMaxValue();
  state.targetId = undefined;
  state.emptySinceTick = now;
  state.nextAttackTick = now + 60;
  setGauntletAnimation(
    boss,
    state.awake
      ? GAUNTLET_ANIMATION_STATE.idle
      : GAUNTLET_ANIMATION_STATE.dormant
  );
  setGauntletDashPhysics(boss, false);
  setGauntletEnergy(boss, 0);
  setGauntletEyeOpen(boss, state.awake);
  setGauntletHandClosed(boss, false);
  setGauntletCombatArmor(boss, false);
}

function tickDormantGauntlet(boss, state, now) {
  attempt(() => boss.clearVelocity(), "stop dormant Nether Gauntlet");
  setGauntletEyeOpen(boss, false);
  // Java keeps the multipart open-hand hitbox while dormant; the eye can be
  // struck to aggro the boss even though it is visually inactive.
  setGauntletHandClosed(boss, false);
  setGauntletCombatArmor(boss, false);
  idleHeal(boss);
  if (now - state.lastIdleParticleTick < 18) {
    return;
  }
  state.lastIdleParticleTick = now;
  spawnParticle(
    boss.dimension,
    GAUNTLET_ENERGY_PARTICLE,
    gauntletEyeOrigin(boss)
  );
}

function activateGauntlet(boss, state, attacker, now) {
  state.awake = true;
  state.targetId = isEntityUsable(attacker) ? attacker.id : state.targetId;
  boss.setDynamicProperty(GAUNTLET_AWAKE_PROPERTY, true);
  const players = combatPlayers(
    boss.dimension,
    boss.location,
    GAUNTLET_COMBAT_RADIUS
  );
  applyMultiplayerScale(boss, state, Math.max(1, players.length));
  setGauntletAnimation(boss, GAUNTLET_ANIMATION_STATE.idle);
  setGauntletEnergy(boss, 0);
  setGauntletEyeOpen(boss, true);
  setGauntletHandClosed(boss, false);
  setGauntletCombatArmor(boss, true);
  state.nextAttackTick = now + 34;
}

function tickGauntlet(boss, now) {
  if (!isEntityUsable(boss)) {
    stateByBossId.delete(boss.id);
    return;
  }
  const state =
    stateByBossId.get(boss.id) ?? initializeGauntlet(boss, now);
  if (now % 5 === 0) {
    attempt(
      () => boss.removeEffect("poison"),
      "clear Nether Gauntlet poison"
    );
    attempt(
      () => boss.removeEffect("wither"),
      "clear Nether Gauntlet wither"
    );
  }
  const health = boss.getComponent("minecraft:health");
  if (!health || health.currentValue <= 0) {
    return;
  }
  if (state.dying) {
    setGauntletCombatArmor(boss, false);
    attempt(
      () => boss.clearVelocity(),
      "hold dying Nether Gauntlet"
    );
    if (now >= state.deathEndTick && !state.finalizingDeath) {
      state.finalizingDeath = true;
      boss.setDynamicProperty(GAUNTLET_DYING_PROPERTY, false);
      attempt(
        () => boss.kill(),
        "complete Nether Gauntlet death"
      );
    }
    return;
  }

  const players = combatPlayers(
    boss.dimension,
    boss.location,
    GAUNTLET_COMBAT_RADIUS
  );
  if (players.length === 0) {
    setGauntletCombatArmor(boss, false);
    idleHeal(boss);
    attempt(() => boss.clearVelocity(), "stop abandoned Nether Gauntlet");
    state.emptySinceTick ??= now;
    state.targetId = undefined;
    if (state.currentAttack) {
      finishAttack(boss, undefined, state, now, true);
    }
    if (now - state.emptySinceTick >= GAUNTLET_RESET_DELAY_TICKS) {
      resetGauntlet(boss, state, now);
    }
    return;
  }
  state.emptySinceTick = undefined;

  if (!state.awake) {
    // Java Gauntlet does not aggro from proximity. It remains dormant until a
    // valid damaging hit reaches the eye multipart.
    tickDormantGauntlet(boss, state, now);
    return;
  }

  setGauntletCombatArmor(boss, true);
  if (now % 20 === 0) {
    applyMultiplayerScale(boss, state, players.length);
  }

  const target = currentTarget(boss, players, state, now);
  if (!isEntityUsable(target)) {
    return;
  }
  if (distance(boss.location, state.home) > GAUNTLET_LEASH_RADIUS) {
    resetGauntlet(boss, state, now);
    return;
  }

  attempt(
    () => boss.lookAt(targetCenter(target)),
    "face Nether Gauntlet target"
  );

  if (state.currentAttack) {
    // Each Bedrock attack owns its locomotion. Charges are exclusive; laser
    // and blindness retain only a reduced tactical hover. This avoids two
    // impulse controllers fighting each other in the same simulation tick.
    if (state.currentAttack.movement !== "exclusive") {
      steerGauntlet(
        boss,
        target,
        state,
        now,
        state.currentAttack.movement === "hover" ? 0.5 : 0.72
      );
    }
    const attackTarget =
      players.find((player) => player.id === state.attackTargetId) ??
      target;
    if (!isEntityUsable(attackTarget)) {
      finishAttack(boss, target, state, now, true);
      return;
    }
    runSafely(
      () =>
        state.currentAttack.tick(
          attackContext(boss, attackTarget, state, now)
        ),
      `tick Nether Gauntlet ${state.currentAttack.id}`
    );
    if (state.attackData?.finished === true || now >= state.attackEndTick) {
      finishAttack(boss, attackTarget, state, now);
    }
    return;
  }

  steerGauntlet(boss, target, state, now);
  if (now < state.nextAttackTick) {
    return;
  }

  const attack = selectAttack(boss, target, state);
  if (!attack) {
    state.nextAttackTick = now + 6;
    return;
  }
  beginAttack(boss, target, state, attack, now);
}

function damagingPlayer(damageSource) {
  const direct = damageSource.damagingEntity;
  if (isEntityUsable(direct) && direct.typeId === "minecraft:player") {
    return direct;
  }
  const projectile = damageSource.damagingProjectile;
  const owner = attempt(
    () => projectile?.getComponent("minecraft:projectile")?.owner,
    "resolve Nether Gauntlet projectile attacker"
  );
  return isEntityUsable(owner) && owner.typeId === "minecraft:player"
    ? owner
    : undefined;
}

function damagingActor(damageSource) {
  if (isEntityUsable(damageSource.damagingEntity)) {
    return damageSource.damagingEntity;
  }
  const projectile = damageSource.damagingProjectile;
  const owner = attempt(
    () => projectile?.getComponent("minecraft:projectile")?.owner,
    "resolve Nether Gauntlet projectile source"
  );
  return isEntityUsable(owner) ? owner : undefined;
}

function rememberProjectile(projectile, now = system.currentTick) {
  if (!isEntityUsable(projectile)) {
    return;
  }
  const hasProjectile = attempt(
    () => projectile.getComponent("minecraft:projectile"),
    "inspect spawned projectile"
  );
  if (!hasProjectile) {
    return;
  }
  projectilePathById.set(projectile.id, {
    previous: { ...projectile.location },
    current: { ...projectile.location },
    tick: now
  });
}

function updateProjectilePaths(now) {
  for (const [projectileId, path] of projectilePathById) {
    const projectile = attempt(
      () => world.getEntity(projectileId),
      "resolve tracked combat projectile"
    );
    if (!isEntityUsable(projectile)) {
      projectilePathById.delete(projectileId);
      continue;
    }
    path.previous = path.current;
    path.current = { ...projectile.location };
    path.tick = now;
  }
}

function damageRay(boss, damageSource) {
  const projectile = damageSource.damagingProjectile;
  if (isEntityUsable(projectile)) {
    const path = projectilePathById.get(projectile.id);
    const current = { ...projectile.location };
    const velocity = attempt(
      () => projectile.getVelocity(),
      "read Nether Gauntlet projectile velocity"
    ) ?? { x: 0, y: 0, z: 0 };
    let previous = path?.previous;
    if (!previous || distance(previous, current) < 0.02) {
      const backwards = normalize(velocity);
      previous = {
        x: current.x - backwards.x * 4,
        y: current.y - backwards.y * 4,
        z: current.z - backwards.z * 4
      };
    }
    const rayDirection = subtract(current, previous);
    return {
      rayOrigin: previous,
      rayDirection,
      maximumDistance: Math.max(4.5, distance(previous, current) + 2),
      inflate: 0.06
    };
  }

  const attacker = damagingActor(damageSource);
  if (!isEntityUsable(attacker)) {
    return undefined;
  }
  const rayOrigin = attempt(
    () => attacker.getHeadLocation(),
    "read Nether Gauntlet attacker head"
  ) ?? attacker.location;
  const eyeLocation = gauntletEyeOrigin(boss);
  const rayDirection = attempt(
    () => attacker.getViewDirection(),
    "read Nether Gauntlet attacker aim"
  ) ?? subtract(eyeLocation, rayOrigin);
  return {
    rayOrigin,
    rayDirection,
    maximumDistance: distance(rayOrigin, eyeLocation) + 2,
    inflate: 0.1
  };
}

function validEyeHit(boss, damageSource) {
  const bossForward =
    attempt(
      () => boss.getViewDirection(),
      "read Nether Gauntlet facing for eye hit"
    ) ?? { x: 0, y: 0, z: 1 };
  if (
    damageSource.cause === EntityDamageCause.blockExplosion ||
    damageSource.cause === EntityDamageCause.entityExplosion
  ) {
    const explosionSource = isEntityUsable(damageSource.damagingEntity)
      ? damageSource.damagingEntity.location
      : isEntityUsable(damageSource.damagingProjectile)
        ? damageSource.damagingProjectile.location
        : undefined;
    if (
      explosionSource &&
      explosionApproachesGauntletRear(
        boss.location,
        bossForward,
        explosionSource
      )
    ) {
      return true;
    }
  }
  const trace = damageRay(boss, damageSource);
  if (!trace) {
    return false;
  }
  const closed = attempt(
    () => boss.getProperty("bomd:gauntlet_hand_closed"),
    "read Nether Gauntlet multipart state"
  ) === true;
  const firstPart = firstGauntletPartHit({
    bossLocation: boss.location,
    bossForward,
    closed,
    ...trace
  });
  return firstPart?.id === "eye";
}

function beginAwakening(boss, attacker) {
  if (!isEntityUsable(boss)) {
    return;
  }
  const state =
    stateByBossId.get(boss.id) ??
    initializeGauntlet(boss, system.currentTick);
  if (state.awake || state.dying) {
    return;
  }
  // In Java GauntletGoalHandler.afterDamage activates the combat goals as soon
  // as the first valid eye hit has actually dealt damage. There is no 14-tick
  // invulnerable awakening state.
  activateGauntlet(boss, state, attacker, system.currentTick);
  playSound(
    boss.dimension,
    "bomd.nether_gauntlet.cast",
    boss.location,
    2.2,
    0.82
  );
}

function deflectInvalidHit(boss, attacker) {
  if (!isEntityUsable(boss)) {
    return;
  }
  const state =
    stateByBossId.get(boss.id) ??
    initializeGauntlet(boss, system.currentTick);
  if (system.currentTick - state.lastDeflectTick < 6) {
    return;
  }
  state.lastDeflectTick = system.currentTick;
  playSound(
    boss.dimension,
    "random.anvil_land",
    gauntletEyeOrigin(boss),
    0.45,
    1.65
  );
  if (isEntityUsable(attacker)) {
    knockPlayer(
      attacker,
      boss.location,
      0.72,
      0.16,
      boss.getViewDirection()
    );
  }
}

function startGauntletDeath(boss, state, now) {
  if (!isEntityUsable(boss) || state.dying) {
    return;
  }
  const target = combatPlayers(
    boss.dimension,
    boss.location,
    GAUNTLET_COMBAT_RADIUS
  )[0];
  if (state.currentAttack) {
    finishAttack(boss, target, state, now, true);
  }

  state.dying = true;
  state.deathEndTick = now + GAUNTLET_DEATH_TICKS;
  state.targetId = undefined;
  state.attackTargetId = undefined;
  boss.setDynamicProperty(GAUNTLET_DYING_PROPERTY, true);
  boss.setDynamicProperty(
    GAUNTLET_DEATH_END_TICK_PROPERTY,
    state.deathEndTick
  );
  const health = boss.getComponent("minecraft:health");
  if (health) {
    health.setCurrentValue(1);
  }
  attempt(
    () => boss.clearVelocity(),
    "stop Nether Gauntlet death sequence"
  );
  setGauntletEyeOpen(boss, false);
  setGauntletHandClosed(boss, true);
  setGauntletCombatArmor(boss, false);
  setGauntletEnergy(boss, 2);
  setGauntletAnimation(boss, GAUNTLET_ANIMATION_STATE.death);
  playSound(
    boss.dimension,
    "bomd.nether_gauntlet.death",
    boss.location,
    3,
    0.9
  );
}

function handleGauntletBeforeHurt(event) {
  const boss = event.hurtEntity;
  if (boss.typeId !== GAUNTLET_TYPE) {
    return;
  }
  const cause = event.damageSource.cause;
  const state = stateByBossId.get(boss.id);
  if (state?.finalizingDeath || BYPASS_DAMAGE_CAUSES.has(cause)) {
    return;
  }
  if (
    state?.dying ||
    attempt(
      () => boss.getDynamicProperty(GAUNTLET_DYING_PROPERTY),
      "read Nether Gauntlet death gate"
    ) === true
  ) {
    event.cancel = true;
    return;
  }

  const attacker = damagingPlayer(event.damageSource);
  if (isEntityUsable(attacker)) markBossAggressor(attacker);
  if (isEntityUsable(attacker) && !isBossCombatPlayer(attacker)) {
    event.cancel = true;
    return;
  }
  const eyeHit = validEyeHit(boss, event.damageSource);
  const awake =
    state?.awake ??
    (attempt(
      () => boss.getDynamicProperty(GAUNTLET_AWAKE_PROPERTY),
      "read Nether Gauntlet wake gate"
    ) === true);
  const eyeOpen =
    attempt(
      () => boss.getProperty(GAUNTLET_EYE_OPEN_PROPERTY),
      "read Nether Gauntlet eye gate"
    ) === true;

  if (!awake) {
    if (!eyeHit) {
      event.cancel = true;
      system.run(() => deflectInvalidHit(boss, attacker));
      return;
    }
    // The first valid hit is real damage in Java. While no target is present,
    // GauntletEntity#getArmor returns 24; afterDamage then activates combat and
    // armor falls back to the configured 8.
    event.damage = damageAfterJavaArmor(event.damage, 24);
    pendingAwakenAttackerByBossId.set(
      boss.id,
      isEntityUsable(attacker) ? attacker.id : undefined
    );
    return;
  }
  if (!eyeOpen || !eyeHit) {
    event.cancel = true;
    system.run(() => deflectInvalidHit(boss, attacker));
    return;
  }

  event.damage = damageAfterJavaArmor(
    event.damage,
    gauntletArmorValue(boss)
  );

  const health = boss.getComponent("minecraft:health");
  if (!health || event.damage < health.currentValue) {
    return;
  }
  event.cancel = true;
  system.run(() => {
    if (!isEntityUsable(boss)) {
      return;
    }
    const currentState =
      stateByBossId.get(boss.id) ??
      initializeGauntlet(boss, system.currentTick);
    startGauntletDeath(boss, currentState, system.currentTick);
  });
}

function handleGauntletHurt(event) {
  const boss = event.hurtEntity;
  if (boss.typeId !== GAUNTLET_TYPE || !isEntityUsable(boss)) {
    return;
  }
  const state =
    stateByBossId.get(boss.id) ??
    initializeGauntlet(boss, system.currentTick);
  if (state.dying) {
    return;
  }

  if (!state.awake && pendingAwakenAttackerByBossId.has(boss.id)) {
    const attackerId = pendingAwakenAttackerByBossId.get(boss.id);
    pendingAwakenAttackerByBossId.delete(boss.id);
    const pendingAttacker = attackerId
      ? attempt(() => world.getEntity(attackerId), "resolve Nether Gauntlet awakening attacker")
      : damagingPlayer(event.damageSource);
    beginAwakening(boss, pendingAttacker);
  }

  state.hurtSerial += 1;
  const hurtSerial = state.hurtSerial;
  attempt(
    () => boss.setProperty("bomd:gauntlet_hurt", 1),
    "show Nether Gauntlet hurt texture"
  );
  system.runTimeout(() => {
    if (
      isEntityUsable(boss) &&
      state.hurtSerial === hurtSerial
    ) {
      attempt(
        () => boss.setProperty("bomd:gauntlet_hurt", 0),
        "restore Nether Gauntlet texture"
      );
    }
  }, 5);

  const attacker = damagingPlayer(event.damageSource);
  if (isBossCombatPlayer(attacker)) {
    state.targetId = attacker.id;
    if (event.damage > 4) {
      state.damageMemory.push({
        playerId: attacker.id,
        damage: event.damage,
        tick: system.currentTick
      });
      state.damageMemory = state.damageMemory.slice(-5);
    }
  }
}

function recoveryScan() {
  const seen = new Set();
  for (const dimensionId of ["overworld", "nether", "the_end"]) {
    const dimension = world.getDimension(dimensionId);
    const bosses =
      attempt(
        () => dimension.getEntities({ type: GAUNTLET_TYPE }),
        `scan Nether Gauntlets in ${dimensionId}`
      ) ?? [];
    for (const boss of bosses) {
      seen.add(boss.id);
      if (!stateByBossId.has(boss.id)) {
        initializeGauntlet(boss, system.currentTick);
      }
    }
  }
  for (const bossId of stateByBossId.keys()) {
    if (!seen.has(bossId)) {
      removeGauntletBeamEntity(stateByBossId.get(bossId)?.attackData);
      stateByBossId.delete(bossId);
    }
  }
}

function managerTick() {
  const now = system.currentTick;
  updateProjectilePaths(now);
  for (const bossId of stateByBossId.keys()) {
    const boss = attempt(
      () => world.getEntity(bossId),
      "resolve tracked Nether Gauntlet"
    );
    if (isEntityUsable(boss)) {
      attempt(
        () => tickGauntlet(boss, now),
        `tick Nether Gauntlet ${bossId}`
      );
    }
  }
}

export function forgetNetherGauntlet(bossId) {
  removeGauntletBeamEntity(stateByBossId.get(bossId)?.attackData);
  pendingAwakenAttackerByBossId.delete(bossId);
  stateByBossId.delete(bossId);
}

export function startNetherGauntletManager() {
  if (started) {
    return;
  }
  started = true;
  world.beforeEvents.entityHurt.subscribe(handleGauntletBeforeHurt);
  world.afterEvents.entityHurt.subscribe((event) => {
    attempt(
      () => handleGauntletHurt(event),
      "handle Nether Gauntlet damage"
    );
  });
  world.afterEvents.entitySpawn.subscribe((event) => {
    system.run(() => {
      if (!isEntityUsable(event.entity)) {
        return;
      }
      rememberProjectile(event.entity, system.currentTick);
      if (event.entity.typeId === GAUNTLET_TYPE) {
        initializeGauntlet(event.entity, system.currentTick);
      }
    });
  });
  recoveryScan();
  system.runInterval(managerTick, 1);
  system.runInterval(recoveryScan, RECOVERY_SCAN_TICKS);
}
