// @ts-check

import { EntityDamageCause, system, world } from "@minecraft/server";
import { voidBlade } from "../attacks/void_blossom/blade.js";
import { voidBlossomAction } from "../attacks/void_blossom/blossom.js";
import { voidSpike } from "../attacks/void_blossom/spike.js";
import { voidSpikeWave } from "../attacks/void_blossom/spike_wave.js";
import { voidSpore } from "../attacks/void_blossom/spore.js";
import { damageAfterJavaArmor } from "../core/armor.js";
import {
  isBossCombatPlayer,
  markBossAggressor
} from "../core/combat_target.js";
import {
  setVoidAnimation,
  setVoidStage,
  voidPlayers
} from "../attacks/void_blossom/shared.js";
import {
  VOID_ANIMATION_STATE,
  VOID_ATTACK_DAMAGE,
  VOID_BALANCE_VERSION_PROPERTY,
  VOID_BLOSSOM_BLOCK,
  VOID_BLOSSOM_HITBOX_TYPE,
  VOID_BLOSSOM_TYPE,
  VOID_COMBAT_RADIUS,
  VOID_DEATH_END_TICK_PROPERTY,
  VOID_DEATH_TICKS,
  VOID_DYING_PROPERTY,
  VOID_HEAL_PARTICLE,
  VOID_HITBOX_OWNER_PROPERTY,
  VOID_HITBOX_STATE_PROPERTY,
  VOID_HOME_X_PROPERTY,
  VOID_HOME_Y_PROPERTY,
  VOID_HOME_Z_PROPERTY,
  VOID_IDLE_HEAL_PER_TICK,
  VOID_INITIAL_COOLDOWN,
  VOID_LEASH_RADIUS,
  VOID_PREVIOUS_ATTACK_PROPERTY,
  VOID_SCALED_PLAYERS_PROPERTY,
  VOID_STAGE_PROPERTY,
  VINE_WALL_BLOCK
} from "../core/config.js";
import { attempt, isEntityUsable, runSafely } from "../core/safe.js";
import {
  distance,
  normalize,
  scale,
  subtract
} from "../core/vector.js";
import {
  cappedVoidHeal,
  clampVoidPlayerCount,
  crossedVoidMilestone,
  firstVoidBlossomPartHit,
  VOID_HITBOX_STATE,
  voidAttackWeights,
  voidHealthStage,
  voidOrientedParts
} from "../core/void_blossom_logic.js";
import {
  balanceRevision,
  effectiveEncounterPlayers,
  profileDamage
} from "../core/balance.js";
import { playSound, spawnBurst, spawnParticle } from "../visuals/frost.js";

const BALANCE_VERSION = 2;
const RECOVERY_SCAN_TICKS = 200;
const BYPASS_DAMAGE_CAUSES = new Set([
  EntityDamageCause.override,
  EntityDamageCause.selfDestruct,
  EntityDamageCause.void
]);

const VOID_LIGHT_PREFIX = "minecraft:light_block_";
const VOID_LIGHT_MAX_LEVEL = 15;

function integerBlockLocation(location) {
  return {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z)
  };
}

function sameBlockLocation(left, right) {
  return left?.x === right?.x && left?.y === right?.y && left?.z === right?.z;
}

function isLightBlock(block) {
  return typeof block?.typeId === "string" && block.typeId.startsWith(VOID_LIGHT_PREFIX);
}

function clearVoidLightAt(dimension, location) {
  if (!location) return;
  const block = attempt(() => dimension.getBlock(location), "read Void Blossom light block");
  if (isLightBlock(block)) {
    attempt(
      () => dimension.setBlockType(location, "minecraft:air"),
      "remove Void Blossom light block"
    );
  }
}

function setVoidLight(boss, state, requestedLevel) {
  const level = Math.max(0, Math.min(VOID_LIGHT_MAX_LEVEL, Math.round(requestedLevel)));
  const location = integerBlockLocation(boss.location);

  if (state.lightLocation && !sameBlockLocation(state.lightLocation, location)) {
    clearVoidLightAt(boss.dimension, state.lightLocation);
  }
  state.lightLocation = location;

  if (level <= 0) {
    clearVoidLightAt(boss.dimension, location);
    return;
  }

  const block = attempt(() => boss.dimension.getBlock(location), "read Void Blossom light position");
  if (!block) return;
  // Match Java's LightBlockPlacer without destroying arena terrain if a malformed
  // spawn point ever places the entity inside a solid block.
  if (block.typeId !== "minecraft:air" && !isLightBlock(block)) return;

  const wanted = `${VOID_LIGHT_PREFIX}${level}`;
  if (block.typeId !== wanted) {
    attempt(
      () => boss.dimension.setBlockType(location, wanted),
      `set Void Blossom light level ${level}`
    );
  }
}

function clearTrackedVoidLight(state) {
  if (!state?.lightLocation || !state.lightDimensionId) return;
  const dimension = attempt(
    () => world.getDimension(state.lightDimensionId),
    "resolve Void Blossom light dimension"
  );
  if (dimension) clearVoidLightAt(dimension, state.lightLocation);
  state.lightLocation = undefined;
}

const stateByBossId = new Map();
let started = false;

function numberProperty(entity, id) {
  const value = attempt(() => entity.getDynamicProperty(id), `read ${id}`);
  return typeof value === "number" ? value : undefined;
}

function readHome(boss) {
  const x = numberProperty(boss, VOID_HOME_X_PROPERTY);
  const y = numberProperty(boss, VOID_HOME_Y_PROPERTY);
  const z = numberProperty(boss, VOID_HOME_Z_PROPERTY);
  if (x !== undefined && y !== undefined && z !== undefined) return { x, y, z };
  const home = { ...boss.location };
  boss.setDynamicProperty(VOID_HOME_X_PROPERTY, home.x);
  boss.setDynamicProperty(VOID_HOME_Y_PROPERTY, home.y);
  boss.setDynamicProperty(VOID_HOME_Z_PROPERTY, home.z);
  return home;
}

function applyScale(boss, state, requestedCount) {
  const count = effectiveEncounterPlayers(
    clampVoidPlayerCount(requestedCount)
  );
  const storedCount = numberProperty(boss, VOID_SCALED_PLAYERS_PROPERTY);
  const version = numberProperty(boss, VOID_BALANCE_VERSION_PROPERTY);
  state.playerCount = count;
  const activeBalanceRevision = balanceRevision(BALANCE_VERSION);
  if (storedCount === count && version === activeBalanceRevision) return;
  const health = boss.getComponent("minecraft:health");
  const ratio = health
    ? health.currentValue / Math.max(1, health.effectiveMax)
    : 1;
  boss.triggerEvent(`bomd:scale_${count}`);
  boss.setDynamicProperty(VOID_SCALED_PLAYERS_PROPERTY, count);
  boss.setDynamicProperty(
    VOID_BALANCE_VERSION_PROPERTY,
    activeBalanceRevision
  );
  system.runTimeout(() => {
    if (!isEntityUsable(boss)) return;
    const scaled = boss.getComponent("minecraft:health");
    if (!scaled) return;
    scaled.setCurrentValue(
      Math.max(1, Math.min(scaled.effectiveMax, scaled.effectiveMax * ratio))
    );
    state.lastHealthRatio = scaled.currentValue / scaled.effectiveMax;
  }, 1);
}

function spawnHitboxes(boss, state) {
  state.hitboxIds ??= [];
  const forward = attempt(
    () => boss.getViewDirection(),
    "read Void Blossom hitbox facing"
  ) ?? { x: 0, y: 0, z: 1 };
  const parts = voidOrientedParts({
    bossLocation: boss.location,
    bossForward: forward,
    state: state.hitboxState ?? VOID_HITBOX_STATE.idle
  });
  const existing = state.hitboxIds
    .map((id) => attempt(() => world.getEntity(id), "resolve Void Blossom hitbox"))
    .filter(isEntityUsable);
  if (existing.length === parts.length) return existing;
  for (const hitbox of existing) attempt(() => hitbox.remove(), "replace Void Blossom hitbox");
  state.hitboxIds = [];
  for (const part of parts) {
    const hitbox = attempt(
      () => boss.dimension.spawnEntity(VOID_BLOSSOM_HITBOX_TYPE, part.center),
      "spawn Void Blossom multipart hitbox"
    );
    if (!isEntityUsable(hitbox)) continue;
    hitbox.setDynamicProperty(VOID_HITBOX_OWNER_PROPERTY, boss.id);
    hitbox.setDynamicProperty("bomd:void_hitbox_part", part.id);
    hitbox.setDynamicProperty("bomd:void_hitbox_thorn", part.thorn);
    attempt(
      () => hitbox.triggerEvent(`bomd:${part.collider}`),
      `shape Void Blossom ${part.id} hitbox`
    );
    hitbox.addTag("bomd:void_part");
    state.hitboxIds.push(hitbox.id);
  }
  return state.hitboxIds
    .map((id) => attempt(() => world.getEntity(id), "read new Void Blossom hitbox"))
    .filter(isEntityUsable);
}

function moveHitboxes(boss, state) {
  const hitboxes = spawnHitboxes(boss, state);
  const forward = attempt(
    () => boss.getViewDirection(),
    "read Void Blossom multipart facing"
  ) ?? { x: 0, y: 0, z: 1 };
  const parts = voidOrientedParts({
    bossLocation: boss.location,
    bossForward: forward,
    state: state.hitboxState ?? VOID_HITBOX_STATE.idle
  });
  for (let index = 0; index < hitboxes.length; index += 1) {
    const desired = parts[index]?.center;
    if (!desired) continue;
    if (distance(hitboxes[index].location, desired) > 0.08) {
      attempt(() => hitboxes[index].teleport(desired), "move Void Blossom hitbox");
    }
  }
}

function setVoidHitboxState(boss, state, value, force = false) {
  if (!force && state.hitboxState === value) return;
  state.hitboxState = value;
  attempt(
    () => boss.setProperty(VOID_HITBOX_STATE_PROPERTY, value),
    "sync Void Blossom multipart state"
  );
  removeHitboxes(state);
  spawnHitboxes(boss, state);
}

function setVoidCombatArmor(boss, state, active) {
  if (state.combatArmorActive === active) return;
  state.combatArmorActive = active;
}

function removeHitboxes(state) {
  for (const id of state.hitboxIds ?? []) {
    const hitbox = attempt(() => world.getEntity(id), "resolve stale Void Blossom hitbox");
    if (isEntityUsable(hitbox)) attempt(() => hitbox.remove(), "remove Void Blossom hitbox");
  }
  state.hitboxIds = [];
}

function initializeBoss(boss, now) {
  const health = boss.getComponent("minecraft:health");
  const ratio = health
    ? health.currentValue / Math.max(1, health.effectiveMax)
    : 1;
  const dying = attempt(
    () => boss.getDynamicProperty(VOID_DYING_PROPERTY),
    "read Void Blossom dying state"
  ) === true;
  const deathEnd = numberProperty(boss, VOID_DEATH_END_TICK_PROPERTY);
  const state = {
    home: readHome(boss),
    targetId: undefined,
    playerCount: clampVoidPlayerCount(
      numberProperty(boss, VOID_SCALED_PLAYERS_PROPERTY) ?? 1
    ),
    currentAttack: undefined,
    attackTargetId: undefined,
    attackStartTick: now,
    attackEndTick: now,
    attackData: {},
    nextAttackTick: now + VOID_INITIAL_COOLDOWN,
    previousAttack: attempt(
      () => boss.getDynamicProperty(VOID_PREVIOUS_ATTACK_PROPERTY),
      "read Void Blossom previous attack"
    ),
    forceBlossom: false,
    lastHealthRatio: ratio,
    lastTargetTick: now - 20,
    lastHealTick: now,
    lastParticleTick: now,
    nextScaleTick: now,
    emptySinceTick: undefined,
    spawnUntil: dying ? undefined : now + 14,
    dying,
    finalizingDeath: false,
    deathEndTick: dying && deathEnd !== undefined ? deathEnd : now + VOID_DEATH_TICKS,
    healerLocations: [],
    hitboxIds: [],
    hitboxState: VOID_HITBOX_STATE.idle,
    combatArmorActive: undefined,
    routedHit: undefined,
    pendingHit: undefined,
    hitCooldowns: new Map(),
    damageMemory: [],
    lightLocation: undefined,
    lightDimensionId: boss.dimension.id
  };
  stateByBossId.set(boss.id, state);
  boss.nameTag = "Void Blossom";
  setVoidAnimation(
    boss,
    dying ? VOID_ANIMATION_STATE.death : VOID_ANIMATION_STATE.spawn
  );
  setVoidStage(boss, voidHealthStage(ratio));
  setVoidCombatArmor(boss, state, false);
  setVoidHitboxState(boss, state, VOID_HITBOX_STATE.idle, true);
  return state;
}

function nearestPlayer(boss, players) {
  return [...players].sort(
    (left, right) => distance(left.location, boss.location) - distance(right.location, boss.location)
  )[0];
}

function chooseTarget(boss, players, state, now) {
  let target = players.find((player) => player.id === state.targetId);
  if (target && now - state.lastTargetTick < 20) return target;
  state.lastTargetTick = now;
  state.damageMemory = state.damageMemory.filter((entry) => now - entry.tick <= 200);
  if (state.damageMemory.length > 0 && Math.random() < 0.5) {
    const totals = new Map();
    for (const entry of state.damageMemory) {
      if (!players.some((player) => player.id === entry.playerId)) continue;
      totals.set(entry.playerId, (totals.get(entry.playerId) ?? 0) + entry.damage);
    }
    const id = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    target = players.find((player) => player.id === id);
  }
  target ??= nearestPlayer(boss, players);
  state.targetId = target?.id;
  return target;
}

function weightedChoice(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = Math.random() * Math.max(0.0001, total);
  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.attack;
  }
  return entries[0].attack;
}

function chooseAttack(boss, target, state) {
  if (state.forceBlossom) return voidBlossomAction;
  const health = boss.getComponent("minecraft:health");
  const ratio = health
    ? health.currentValue / Math.max(1, health.effectiveMax)
    : 1;
  const weights = voidAttackWeights({
    healthRatio: ratio,
    targetDistance: distance(boss.location, target.location)
  });
  return weightedChoice([
    { attack: voidSpike, weight: weights.spike },
    { attack: voidSpikeWave, weight: weights.spikeWave },
    { attack: voidSpore, weight: weights.spore },
    { attack: voidBlade, weight: weights.blade }
  ].filter((entry) => entry.weight > 0));
}

function context(boss, target, state, now) {
  return { boss, target, state, now, elapsed: now - state.attackStartTick };
}

function updateAttackHitboxState(boss, state, elapsed) {
  switch (state.currentAttack?.id) {
    case "spike":
      if (elapsed === 20) setVoidHitboxState(boss, state, VOID_HITBOX_STATE.spike);
      if (elapsed === 120) setVoidHitboxState(boss, state, VOID_HITBOX_STATE.idle);
      break;
    case "spike_wave":
      if (elapsed === 20) setVoidHitboxState(boss, state, VOID_HITBOX_STATE.spikeWave1);
      if (elapsed === 46) setVoidHitboxState(boss, state, VOID_HITBOX_STATE.spikeWave2);
      if (elapsed === 72) setVoidHitboxState(boss, state, VOID_HITBOX_STATE.spikeWave3);
      if (elapsed === 98) setVoidHitboxState(boss, state, VOID_HITBOX_STATE.idle);
      break;
    case "spore":
      if (elapsed === 20) setVoidHitboxState(boss, state, VOID_HITBOX_STATE.spore);
      if (elapsed === 47) setVoidHitboxState(boss, state, VOID_HITBOX_STATE.idle);
      break;
    case "blade":
      if (elapsed === 10) setVoidHitboxState(boss, state, VOID_HITBOX_STATE.petal);
      if (elapsed === 100) setVoidHitboxState(boss, state, VOID_HITBOX_STATE.idle);
      break;
    case "blossom":
      if (elapsed === 20) setVoidHitboxState(boss, state, VOID_HITBOX_STATE.spikeWave3);
      if (elapsed === 100) setVoidHitboxState(boss, state, VOID_HITBOX_STATE.idle);
      break;
    default:
      break;
  }
}

function beginAttack(boss, target, state, attack, now) {
  state.currentAttack = attack;
  state.attackTargetId = target.id;
  state.attackStartTick = now;
  state.attackEndTick = now + attack.duration;
  state.attackData = {};
  setVoidHitboxState(boss, state, VOID_HITBOX_STATE.idle);
  if (attack.id === "blossom") state.forceBlossom = false;
  if (!runSafely(() => attack.start(context(boss, target, state, now)), `start Void Blossom ${attack.id}`)) {
    state.currentAttack = undefined;
    state.nextAttackTick = now + 20;
    return;
  }
  state.previousAttack = attack.id;
  boss.setDynamicProperty(VOID_PREVIOUS_ATTACK_PROPERTY, attack.id);
}

function finishAttack(boss, target, state, now, cancelled = false) {
  const attack = state.currentAttack;
  if (attack) runSafely(
    () => attack.finish(context(boss, target, state, now)),
    `finish Void Blossom ${attack.id}`
  );
  state.currentAttack = undefined;
  state.attackTargetId = undefined;
  state.attackData = {};
  setVoidHitboxState(boss, state, VOID_HITBOX_STATE.idle);
  state.nextAttackTick = now + (cancelled ? 30 : attack?.recovery ?? 0);
}

function healToMilestone(boss, amount) {
  const health = boss.getComponent("minecraft:health");
  if (!health || health.currentValue >= health.effectiveMax) return;
  health.setCurrentValue(cappedVoidHeal(
    health.currentValue,
    health.effectiveMax,
    amount
  ));
}

function tickHealingBlossoms(boss, state, now) {
  if (now - state.lastHealTick < 64) return;
  state.lastHealTick = now;
  state.healerLocations = state.healerLocations.filter((location) => {
    const block = attempt(
      () => boss.dimension.getBlock(location),
      "read healing Void Blossom"
    );
    if (block?.typeId !== VOID_BLOSSOM_BLOCK) return false;
    if (distance(location, boss.location) <= 24) {
      healToMilestone(boss, 10);
      spawnParticle(boss.dimension, VOID_HEAL_PARTICLE, {
        x: location.x + 0.5,
        y: location.y + 0.8,
        z: location.z + 0.5
      });
      spawnParticle(boss.dimension, VOID_HEAL_PARTICLE, {
        x: boss.location.x,
        y: boss.location.y + 5,
        z: boss.location.z
      });
    }
    return true;
  });
}

function removeEncounterPlants(boss, state) {
  for (const location of state.healerLocations) {
    const flower = attempt(() => boss.dimension.getBlock(location), "read stale healing flower");
    if (flower?.typeId === VOID_BLOSSOM_BLOCK) flower.setType("minecraft:air");
    for (let x = -1; x <= 1; x += 1) {
      for (let z = -1; z <= 1; z += 1) {
        for (let y = 0; y <= 2; y += 1) {
          const block = attempt(
            () => boss.dimension.getBlock({ x: location.x + x, y: location.y + y, z: location.z + z }),
            "read stale vine wall"
          );
          if (block?.typeId === VINE_WALL_BLOCK) block.setType("minecraft:air");
        }
      }
    }
  }
  state.healerLocations = [];
}

function startDeath(boss, state, now) {
  if (state.dying) return;
  const target = attempt(
    () => world.getEntity(state.attackTargetId),
    "resolve Void Blossom death target"
  );
  if (state.currentAttack) finishAttack(boss, target, state, now, true);
  state.dying = true;
  state.targetId = undefined;
  state.deathEndTick = now + VOID_DEATH_TICKS;
  boss.setDynamicProperty(VOID_DYING_PROPERTY, true);
  boss.setDynamicProperty(VOID_DEATH_END_TICK_PROPERTY, state.deathEndTick);
  boss.getComponent("minecraft:health")?.setCurrentValue(1);
  setVoidAnimation(boss, VOID_ANIMATION_STATE.death);
  setVoidCombatArmor(boss, state, false);
  removeHitboxes(state);
  removeEncounterPlants(boss, state);
  playSound(boss.dimension, "bomd.void_blossom.hurt", boss.location, 1.5, 0.72);
}

function resetBoss(boss, state, now) {
  if (state.currentAttack) finishAttack(boss, undefined, state, now, true);
  removeEncounterPlants(boss, state);
  attempt(() => boss.teleport(state.home), "reset Void Blossom position");
  boss.getComponent("minecraft:health")?.resetToMaxValue();
  state.lastHealthRatio = 1;
  state.forceBlossom = false;
  state.targetId = undefined;
  state.nextAttackTick = now + VOID_INITIAL_COOLDOWN;
  setVoidAnimation(boss, VOID_ANIMATION_STATE.idle);
  setVoidStage(boss, 4);
  setVoidCombatArmor(boss, state, false);
  setVoidHitboxState(boss, state, VOID_HITBOX_STATE.idle, true);
}

function tickBoss(boss, now) {
  if (!isEntityUsable(boss)) return;
  const state = stateByBossId.get(boss.id) ?? initializeBoss(boss, now);
  if (state.dying) {
    const deathTick = Math.max(0, Math.min(70, VOID_DEATH_TICKS - (state.deathEndTick - now)));
    attempt(() => boss.setProperty("bomd:void_death_tick", deathTick), "advance Void Blossom death fade");
    // Java fades Blocks.LIGHT from level 15 to 0 over the death sequence.
    const lightLevel = Math.max(
      0,
      Math.round((1 - deathTick / Math.max(1, VOID_DEATH_TICKS)) * VOID_LIGHT_MAX_LEVEL)
    );
    setVoidLight(boss, state, lightLevel);
    if (now >= state.deathEndTick && !state.finalizingDeath) {
      state.finalizingDeath = true;
      clearTrackedVoidLight(state);
      boss.setDynamicProperty(VOID_DYING_PROPERTY, false);
      attempt(() => boss.kill(), "complete Void Blossom death");
    }
    return;
  }

  // Java's Void Blossom runs LightBlockPlacer every server tick.
  setVoidLight(boss, state, VOID_LIGHT_MAX_LEVEL);

  attempt(() => boss.clearVelocity(), "hold Void Blossom position");
  if (distance(boss.location, state.home) > 0.75) {
    attempt(() => boss.teleport(state.home), "restore Void Blossom root");
  }
  moveHitboxes(boss, state);
  tickHealingBlossoms(boss, state, now);

  const health = boss.getComponent("minecraft:health");
  if (!health || health.currentValue <= 0) return;
  const ratio = health.currentValue / Math.max(1, health.effectiveMax);
  if (crossedVoidMilestone(state.lastHealthRatio, ratio)) state.forceBlossom = true;
  state.lastHealthRatio = ratio;
  const stage = voidHealthStage(ratio);
  setVoidStage(boss, stage);
  boss.setDynamicProperty(VOID_STAGE_PROPERTY, stage);

  if (state.spawnUntil !== undefined) {
    if (now < state.spawnUntil) return;
    state.spawnUntil = undefined;
    setVoidAnimation(boss, VOID_ANIMATION_STATE.idle);
  }

  const players = voidPlayers(boss.dimension, boss.location, VOID_COMBAT_RADIUS);
  if (players.length === 0) {
    state.emptySinceTick ??= now;
    state.targetId = undefined;
    setVoidCombatArmor(boss, state, false);
    healToMilestone(boss, VOID_IDLE_HEAL_PER_TICK);
    if (state.currentAttack) finishAttack(boss, undefined, state, now, true);
    if (now - state.emptySinceTick >= 200) resetBoss(boss, state, now);
    return;
  }
  state.emptySinceTick = undefined;
  setVoidCombatArmor(boss, state, true);
  if (now >= state.nextScaleTick) {
    state.nextScaleTick = now + 20;
    applyScale(boss, state, players.length);
  }
  const target = chooseTarget(boss, players, state, now);
  if (!isEntityUsable(target)) return;
  if (distance(boss.location, state.home) > VOID_LEASH_RADIUS) {
    resetBoss(boss, state, now);
    return;
  }
  attempt(
    () => boss.lookAt({ x: target.location.x, y: target.location.y + 1.2, z: target.location.z }),
    "face Void Blossom target"
  );

  if (state.currentAttack) {
    const attackTarget = players.find((player) => player.id === state.attackTargetId) ?? target;
    if (!isEntityUsable(attackTarget)) {
      finishAttack(boss, target, state, now, true);
      return;
    }
    const elapsed = now - state.attackStartTick;
    updateAttackHitboxState(boss, state, elapsed);
    runSafely(
      () => state.currentAttack.tick(context(boss, attackTarget, state, now)),
      `tick Void Blossom ${state.currentAttack.id}`
    );
    if (now >= state.attackEndTick) finishAttack(boss, attackTarget, state, now);
    return;
  }
  if (now >= state.nextAttackTick) beginAttack(boss, target, state, chooseAttack(boss, target, state), now);
}

function damagingPlayer(source) {
  if (isEntityUsable(source.damagingEntity) && source.damagingEntity.typeId === "minecraft:player") {
    return source.damagingEntity;
  }
  const owner = attempt(
    () => source.damagingProjectile?.getComponent("minecraft:projectile")?.owner,
    "resolve Void Blossom projectile attacker"
  );
  return isEntityUsable(owner) && owner.typeId === "minecraft:player" ? owner : undefined;
}

function damagingActor(source) {
  if (isEntityUsable(source.damagingEntity)) return source.damagingEntity;
  const owner = attempt(
    () => source.damagingProjectile?.getComponent("minecraft:projectile")?.owner,
    "resolve Void Blossom damage owner"
  );
  return isEntityUsable(owner) ? owner : undefined;
}

function voidDamageRay(boss, source) {
  const projectile = source.damagingProjectile;
  if (isEntityUsable(projectile)) {
    const current = { ...projectile.location };
    const velocity = attempt(
      () => projectile.getVelocity(),
      "read Void Blossom projectile velocity"
    ) ?? { x: 0, y: 0, z: 0 };
    let direction = normalize(velocity);
    if (Math.abs(direction.x) + Math.abs(direction.y) + Math.abs(direction.z) < 0.001) {
      direction = normalize(subtract(
        { x: boss.location.x, y: boss.location.y + 4, z: boss.location.z },
        current
      ));
    }
    return {
      rayOrigin: subtract(current, scale(direction, 5)),
      rayDirection: direction,
      maximumDistance: 8,
      inflate: 0.08
    };
  }

  const attacker = damagingActor(source);
  if (!isEntityUsable(attacker)) return undefined;
  const explosion =
    source.cause === EntityDamageCause.blockExplosion ||
    source.cause === EntityDamageCause.entityExplosion;
  const rayOrigin = explosion
    ? { ...attacker.location }
    : attempt(
      () => attacker.getHeadLocation(),
      "read Void Blossom attacker head"
    ) ?? attacker.location;
  const blossomCenter = {
    x: boss.location.x,
    y: boss.location.y + 4,
    z: boss.location.z
  };
  const rayDirection = explosion
    ? subtract(blossomCenter, rayOrigin)
    : attempt(
      () => attacker.getViewDirection(),
      "read Void Blossom attacker aim"
    ) ?? subtract(blossomCenter, rayOrigin);
  return {
    rayOrigin,
    rayDirection,
    maximumDistance: distance(rayOrigin, blossomCenter) + 5,
    inflate: explosion ? 1.25 : 0.12
  };
}

function validatedVoidPart(boss, state, source) {
  const ray = voidDamageRay(boss, source);
  if (!ray) return undefined;
  const forward = attempt(
    () => boss.getViewDirection(),
    "read Void Blossom damage facing"
  ) ?? { x: 0, y: 0, z: 1 };
  return firstVoidBlossomPartHit({
    bossLocation: boss.location,
    bossForward: forward,
    state: state.hitboxState ?? VOID_HITBOX_STATE.idle,
    ...ray
  });
}

function routeHitboxDamage(event) {
  const hitbox = event.hurtEntity;
  if (hitbox.typeId !== VOID_BLOSSOM_HITBOX_TYPE) return false;
  event.cancel = true;
  const ownerId = attempt(
    () => hitbox.getDynamicProperty(VOID_HITBOX_OWNER_PROPERTY),
    "read Void Blossom hitbox owner"
  );
  const boss = typeof ownerId === "string"
    ? attempt(() => world.getEntity(ownerId), "resolve Void Blossom hitbox owner")
    : undefined;
  if (!isEntityUsable(boss) || boss.typeId !== VOID_BLOSSOM_TYPE) return true;
  const state = stateByBossId.get(boss.id) ?? initializeBoss(boss, system.currentTick);
  if (state.dying || state.finalizingDeath) return true;
  const source = event.damageSource;
  const directDamager = damagingActor(source);
  if (isEntityUsable(directDamager) && directDamager.id === boss.id) {
    return true;
  }
  const part = validatedVoidPart(boss, state, source);
  if (!part) return true;
  const damage = event.damage;
  const damagerId = isEntityUsable(directDamager)
    ? directDamager.id
    : undefined;
  const projectileHit = isEntityUsable(source.damagingProjectile);
  const projectileCause = source.cause === EntityDamageCause.projectile ||
    source.cause === "projectile";
  const routedCause = projectileCause
    ? EntityDamageCause.entityAttack
    : source.cause;
  system.run(() => {
    if (!isEntityUsable(boss)) return;
    const damager = damagerId
      ? attempt(
        () => world.getEntity(damagerId),
        "resolve Void Blossom multipart attacker"
      )
      : undefined;
    state.routedHit = {
      tick: system.currentTick,
      partId: part.id,
      thorn: part.thorn,
      projectile: projectileHit,
      attackerId: damagerId
    };
    const applied = attempt(
      () => boss.applyDamage(
        damage,
        isEntityUsable(damager)
          ? { cause: routedCause, damagingEntity: damager }
          : { cause: routedCause }
      ),
      "route Void Blossom multipart damage"
    );
    if (applied !== true) state.routedHit = undefined;
  });
  return true;
}

function handleBeforeHurt(event) {
  const aggressor = damagingPlayer(event.damageSource);
  if (isEntityUsable(aggressor)) markBossAggressor(aggressor);
  if (routeHitboxDamage(event)) return;
  const boss = event.hurtEntity;
  if (boss.typeId !== VOID_BLOSSOM_TYPE) return;
  const state = stateByBossId.get(boss.id) ?? initializeBoss(boss, system.currentTick);
  const directDamager = damagingActor(event.damageSource);
  if (isEntityUsable(directDamager) && directDamager.id === boss.id) {
    event.cancel = true;
    return;
  }
  if (state.finalizingDeath || BYPASS_DAMAGE_CAUSES.has(event.damageSource.cause)) return;
  if (state.dying) {
    event.cancel = true;
    return;
  }
  const now = system.currentTick;
  let hit = state.routedHit?.tick === now
    ? state.routedHit
    : undefined;
  if (hit) {
    state.routedHit = undefined;
  } else {
    const part = validatedVoidPart(boss, state, event.damageSource);
    if (!part) {
      event.cancel = true;
      return;
    }
    const attacker = damagingActor(event.damageSource);
    hit = {
      tick: now,
      partId: part.id,
      thorn: part.thorn,
      projectile: isEntityUsable(event.damageSource.damagingProjectile),
      attackerId: isEntityUsable(attacker) ? attacker.id : undefined
    };
  }
  state.pendingHit = hit;
  event.damage = damageAfterJavaArmor(
    event.damage,
    state.combatArmorActive === true ? 4 : 20
  );
  const health = boss.getComponent("minecraft:health");
  if (health && event.damage >= health.currentValue) {
    event.cancel = true;
    system.run(() => {
      if (isEntityUsable(boss)) startDeath(boss, state, system.currentTick);
    });
  }
}

function handleAfterHurt(event) {
  const boss = event.hurtEntity;
  if (boss.typeId !== VOID_BLOSSOM_TYPE || !isEntityUsable(boss)) return;
  const state = stateByBossId.get(boss.id) ?? initializeBoss(boss, system.currentTick);
  if (state.dying) return;
  const hit = state.pendingHit?.tick === system.currentTick
    ? state.pendingHit
    : undefined;
  state.pendingHit = undefined;
  if (hit?.thorn && !hit.projectile && hit.attackerId) {
    const thornTarget = attempt(
      () => world.getEntity(hit.attackerId),
      "resolve Void Blossom thorn target"
    );
    if (isBossCombatPlayer(thornTarget)) {
      attempt(
        () => thornTarget.applyDamage(profileDamage(12, 8), {
          cause: EntityDamageCause.thorns,
          damagingEntity: boss
        }),
        "apply Void Blossom thorn retaliation"
      );
    }
  }
  const attacker = damagingPlayer(event.damageSource);
  if (isBossCombatPlayer(attacker)) {
    state.targetId = attacker.id;
    if (event.damage >= 4) {
      state.damageMemory.push({ playerId: attacker.id, damage: event.damage, tick: system.currentTick });
      state.damageMemory = state.damageMemory.slice(-10);
    }
  }
  attempt(() => boss.setProperty("bomd:void_hurt", true), "show Void Blossom hurt tint");
  system.runTimeout(() => {
    if (isEntityUsable(boss)) attempt(
      () => boss.setProperty("bomd:void_hurt", false),
      "clear Void Blossom hurt tint"
    );
  }, 4);
  playSound(boss.dimension, "bomd.void_blossom.hurt", boss.location, 1.5, 1);
}

function recoveryScan() {
  const seen = new Set();
  for (const dimensionId of ["overworld", "nether", "the_end"]) {
    const dimension = world.getDimension(dimensionId);
    const bosses = attempt(
      () => dimension.getEntities({ type: VOID_BLOSSOM_TYPE }),
      `recover Void Blossoms in ${dimensionId}`
    ) ?? [];
    for (const boss of bosses) {
      seen.add(boss.id);
      if (!stateByBossId.has(boss.id)) initializeBoss(boss, system.currentTick);
    }
  }
  for (const [id, state] of stateByBossId) {
    const boss = attempt(() => world.getEntity(id), "resolve tracked Void Blossom");
    if (!isEntityUsable(boss) && !seen.has(id)) {
      removeHitboxes(state);
      clearTrackedVoidLight(state);
      stateByBossId.delete(id);
    }
  }
}

function managerTick() {
  const now = system.currentTick;
  for (const [id, state] of stateByBossId) {
    const boss = attempt(() => world.getEntity(id), "resolve active Void Blossom");
    if (!isEntityUsable(boss)) continue;
    attempt(() => tickBoss(boss, now), `tick Void Blossom ${id}`);
  }
}

export function forgetVoidBlossom(id) {
  const state = stateByBossId.get(id);
  if (state) {
    removeHitboxes(state);
    clearTrackedVoidLight(state);
  }
  stateByBossId.delete(id);
}

export function startVoidBlossomManager() {
  if (started) return;
  started = true;
  world.beforeEvents.entityHurt.subscribe(handleBeforeHurt);
  world.afterEvents.entityHurt.subscribe((event) => attempt(
    () => handleAfterHurt(event),
    "handle Void Blossom damage"
  ));
  world.afterEvents.entitySpawn.subscribe((event) => {
    if (event.entity.typeId === VOID_BLOSSOM_TYPE) {
      system.run(() => {
        if (isEntityUsable(event.entity)) initializeBoss(event.entity, system.currentTick);
      });
    }
  });
  recoveryScan();
  system.runInterval(managerTick, 1);
  system.runInterval(recoveryScan, RECOVERY_SCAN_TICKS);
}
