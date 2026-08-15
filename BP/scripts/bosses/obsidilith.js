// @ts-check

import { Difficulty, EntityDamageCause, system, world } from "@minecraft/server";
import {
  OBSIDILITH_ANIMATION_STATE,
  OBSIDILITH_BURST_PARTICLE,
  OBSIDILITH_COMBAT_RADIUS,
  OBSIDILITH_HOME_X_PROPERTY,
  OBSIDILITH_HOME_Y_PROPERTY,
  OBSIDILITH_HOME_Z_PROPERTY,
  OBSIDILITH_LEASH_RADIUS,
  OBSIDILITH_PILLAR_RUNE_PARTICLE,
  OBSIDILITH_SPIKE_PARTICLE,
  OBSIDILITH_TYPE,
  OBSIDILITH_WAVE_PARTICLE
} from "../core/config.js";
import { isBossCombatPlayer } from "../core/combat_target.js";
import { attempt, isEntityUsable, runSafely } from "../core/safe.js";
import { distance, normalize } from "../core/vector.js";
import { playSound, spawnBurst, spawnParticle } from "../visuals/frost.js";
import { tickAnvil } from "./obsidilith/attacks/anvil.js";
import { startBurst } from "./obsidilith/attacks/burst.js";
import {
  activeRunes,
  buildPillars,
  findPillarPositions
} from "./obsidilith/attacks/pillar-defense.js";
import { tickSpike } from "./obsidilith/attacks/spike.js";
import { tickWave } from "./obsidilith/attacks/wave.js";
import { recordTargetPositions } from "./obsidilith/prediction-system.js";
import {
  clearCurrentTarget,
  rememberPlayerDamage,
  selectCombatTarget
} from "./obsidilith/targeting-system.js";
import { chargeAura, drawShieldLink } from "./obsidilith/visual-effects.js";

const states = new Map();
const HEALTH_MILESTONES = [0.0, 0.25, 0.5, 0.75, 1.0];
const ATTACK_END_TICKS = Object.freeze({
  burst: 55,
  wave: 78,
  spikes: 118,
  anvil: 78
});
const ATTACK_COOLDOWN_TICKS = Object.freeze({
  burst: 80,
  wave: 80,
  spikes: 100,
  anvil: 80
});
let started = false;
let damageEventsRegistered = false;

function playersNear(boss, radius = OBSIDILITH_COMBAT_RADIUS) {
  // Query the dimension first and apply the radius ourselves. This keeps the
  // combat loop reliable across Script API builds and for command-spawned
  // bosses while still excluding non-Survival players.
  return (attempt(
    () => boss.dimension.getPlayers(),
    "query Obsidilith attack targets"
  ) ?? []).filter((player) =>
    isBossCombatPlayer(player) && distance(player.location, boss.location) <= radius
  );
}

function setAnimation(boss, value) {
  attempt(() => boss.setProperty("bomd:obsidilith_animation", value), "set Obsidilith animation");
}

function setEnergy(boss, value) {
  attempt(() => boss.setProperty("bomd:obsidilith_energy", value), "set Obsidilith energy");
}

function setShield(boss, value) {
  attempt(() => boss.setProperty("bomd:obsidilith_shielded", value), "set Obsidilith shield");
}

function setHurt(boss, value) {
  attempt(() => boss.setProperty("bomd:obsidilith_hurt", value), "set Obsidilith hurt flash");
}

function setDeathTick(boss, value) {
  attempt(() => boss.setProperty("bomd:obsidilith_death_tick", value), "set Obsidilith death tick");
}

function targetPoint(player) {
  const collision = attempt(() => player.getComponent("minecraft:collision_box"), "read Obsidilith target bounds");
  const height = typeof collision?.height === "number" ? collision.height : 1.8;
  return {
    x: player.location.x,
    y: player.location.y + height * 0.5,
    z: player.location.z
  };
}

function readHome(boss) {
  const x = boss.getDynamicProperty(OBSIDILITH_HOME_X_PROPERTY);
  const y = boss.getDynamicProperty(OBSIDILITH_HOME_Y_PROPERTY);
  const z = boss.getDynamicProperty(OBSIDILITH_HOME_Z_PROPERTY);
  if ([x, y, z].every((value) => typeof value === "number")) return { x, y, z };
  const home = { ...boss.location };
  boss.setDynamicProperty(OBSIDILITH_HOME_X_PROPERTY, home.x);
  boss.setDynamicProperty(OBSIDILITH_HOME_Y_PROPERTY, home.y);
  boss.setDynamicProperty(OBSIDILITH_HOME_Z_PROPERTY, home.z);
  return home;
}

function initialize(boss, now) {
  const state = {
    home: readHome(boss),
    currentTargetId: undefined,
    lastTargetId: undefined,
    damageByPlayer: new Map(),
    damageHistory: [],
    targetSwitchCooldown: now,
    validTargets: [],
    positionHistory: new Map(),
    currentAttack: undefined,
    attackStart: now,
    nextAttack: now + 80,
    attackData: {},
    shielded: false,
    pillarStage: 0,
    pendingPillarDefense: false,
    pillarStarted: 0,
    runePositions: [],
    previousAttacks: [],
    summonUntil: now + 31,
    awakened: false,
    dying: false,
    finalizingDeath: false,
    deathStart: 0,
    hurtUntil: 0
  };
  states.set(boss.id, state);
  boss.nameTag = "Obsidilith";
  setAnimation(boss, OBSIDILITH_ANIMATION_STATE.summon);
  setEnergy(boss, false);
  setShield(boss, false);
  setHurt(boss, false);
  setDeathTick(boss, 0);
  return state;
}

function beginPillarDefense(boss, state, now) {
  const positions = findPillarPositions(boss);
  state.currentAttack = "pillars";
  state.attackStart = now;
  state.pillarStarted = now;
  state.pendingPillarDefense = false;
  state.attackData = { positions, built: false };
  state.pillarStage += 1;
  setAnimation(boss, OBSIDILITH_ANIMATION_STATE.pillars);
  setEnergy(boss, true);
  chargeAura(boss, OBSIDILITH_PILLAR_RUNE_PARTICLE, 48);
  playSound(boss.dimension, "bomd.obsidilith.prepare_attack", boss.location, 3, 1.4);
}

function completePillarDefense(boss, state) {
  const runes = buildPillars(boss, state.attackData.positions ?? []);
  state.runePositions = runes;
  state.shielded = runes.length > 0;
  state.currentAttack = undefined;
  state.attackData = {};
  setShield(boss, state.shielded);
  if (state.shielded) {
    setAnimation(boss, OBSIDILITH_ANIMATION_STATE.shielded);
    setEnergy(boss, true);
  } else {
    setAnimation(boss, OBSIDILITH_ANIMATION_STATE.idle);
    setEnergy(boss, false);
    state.nextAttack = state.pillarStarted + 100;
  }
}

function refreshShield(boss, state, now) {
  if (!state.shielded) return;
  state.runePositions = activeRunes(boss, state.runePositions);
  state.shielded = state.runePositions.length > 0;
  setShield(boss, state.shielded);
  if (!state.shielded) {
    setEnergy(boss, false);
    setAnimation(boss, OBSIDILITH_ANIMATION_STATE.idle);
    state.nextAttack = Math.max(now + 20, state.pillarStarted + 100);
    playSound(boss.dimension, "random.anvil_break", boss.location, 1.4, 1.25);
    spawnBurst(boss.dimension, boss.location, 36, 2.8, OBSIDILITH_PILLAR_RUNE_PARTICLE);
  }
}

function beginAttack(boss, state, target, id, now) {
  state.currentAttack = id;
  state.attackStart = now;
  state.attackData = {
    target: targetPoint(target),
    targetId: target.id,
    fired: new Set(),
    returnPosition: { ...boss.location }
  };
  state.previousAttacks.push(id);
  state.previousAttacks = state.previousAttacks.slice(-2);
  setEnergy(boss, true);
  setAnimation(boss, OBSIDILITH_ANIMATION_STATE[id]);
  const chargeParticle = id === "burst"
    ? OBSIDILITH_BURST_PARTICLE
    : id === "wave"
      ? OBSIDILITH_WAVE_PARTICLE
      : id === "spikes"
        ? OBSIDILITH_SPIKE_PARTICLE
        : OBSIDILITH_PILLAR_RUNE_PARTICLE;
  chargeAura(boss, chargeParticle);
  playSound(boss.dimension, "bomd.obsidilith.prepare_attack", boss.location, 3, {
    burst: 0.7,
    wave: 0.8,
    spikes: 1.2,
    anvil: 1.0
  }[id] ?? 1);
  if (id === "burst") startBurst(boss);
}

function finishAttack(boss, state, now) {
  const id = state.currentAttack;
  if (id === "anvil" && state.attackData.returnPosition && !state.attackData.returned) {
    attempt(() => boss.teleport(state.attackData.returnPosition), "apply Anvil safety return");
  }
  state.currentAttack = undefined;
  state.attackData = {};
  const cooldown = ATTACK_COOLDOWN_TICKS[id] ?? 80;
  state.nextAttack = Math.max(now + 2, state.attackStart + cooldown);
  setEnergy(boss, false);
  setAnimation(boss, OBSIDILITH_ANIMATION_STATE.idle);
}

function tickAttack(boss, state, target, now) {
  const elapsed = now - state.attackStart;
  const data = state.attackData;
  if (state.currentAttack === "pillars") {
    if (elapsed >= 40 && !data.built) {
      data.built = true;
      completePillarDefense(boss, state);
    }
    return;
  }
  if (state.currentAttack === "wave") {
    tickWave(boss, data, elapsed);
  } else if (state.currentAttack === "spikes") {
    tickSpike(boss, data, target, state.positionHistory, elapsed);
  } else if (state.currentAttack === "anvil") {
    tickAnvil(boss, data, target, elapsed);
  }
  if (elapsed >= (ATTACK_END_TICKS[state.currentAttack] ?? 80)) finishAttack(boss, state, now);
}

function chooseAttack(state, target, boss) {
  if (distance(boss.location, target.location) < 6) {
    const closePool = ["burst", "burst", "wave"];
    return closePool[Math.floor(Math.random() * closePool.length)];
  }
  const farPool = ["wave", "spikes"];
  if (!state.previousAttacks.includes("anvil")) farPool.push("anvil");
  return farPool[Math.floor(Math.random() * farPool.length)] ?? "wave";
}

function healWhileIdle(boss, health) {
  const max = Math.max(1, health.effectiveMax);
  const ratio = health.currentValue / max;
  const capRatio = HEALTH_MILESTONES.find((milestone) => milestone > ratio) ?? 1;
  // Java leaves one hit point below the next stage so idle healing cannot
  // retrigger a phase boundary by itself.
  const cap = Math.max(0, capRatio * max - 1);
  if (health.currentValue >= cap) return;
  attempt(
    () => health.setCurrentValue(Math.min(cap, health.currentValue + 0.5)),
    "heal idle Obsidilith within health segment"
  );
}

function tickShieldEffects(boss, state, now) {
  if (now % 8 === 0) {
    for (const rune of state.runePositions) {
      spawnParticle(boss.dimension, OBSIDILITH_PILLAR_RUNE_PARTICLE, {
        x: rune.x + 0.5,
        y: rune.y + 0.8,
        z: rune.z + 0.5
      });
    }
  }
  if (now % 40 === 0 && state.runePositions.length > 0) {
    drawShieldLink(boss, state.runePositions[Math.floor(Math.random() * state.runePositions.length)]);
  }
}

function tickDeathSequence(boss, state, now) {
  const elapsed = Math.min(80, Math.max(0, now - state.deathStart));
  setDeathTick(boss, elapsed);
  attempt(() => boss.clearVelocity(), "anchor dying Obsidilith");
  if (elapsed % 4 === 0) {
    spawnParticle(boss.dimension, OBSIDILITH_PILLAR_RUNE_PARTICLE, {
      x: boss.location.x + (Math.random() - 0.5) * 5,
      y: boss.location.y + Math.random() * 4.5,
      z: boss.location.z + (Math.random() - 0.5) * 5
    });
  }
}

function startDeathSequence(boss, state) {
  if (!isEntityUsable(boss)) return;
  const health = boss.getComponent("minecraft:health");
  attempt(() => health?.setCurrentValue(1), "hold Obsidilith for death sequence");
  state.currentAttack = "death";
  state.attackData = {};
  state.shielded = false;
  state.runePositions = [];
  state.deathStart = system.currentTick;
  setShield(boss, false);
  setEnergy(boss, true);
  setHurt(boss, false);
  setAnimation(boss, OBSIDILITH_ANIMATION_STATE.death);
  attempt(() => boss.teleport(state.home), "return dying Obsidilith to its monolith position");
  playSound(boss.dimension, "dig.basalt", boss.location, 2.2, 0.55);
  system.runTimeout(() => {
    if (isEntityUsable(boss)) {
      state.finalizingDeath = true;
      attempt(() => boss.kill(), "finish Obsidilith death sequence");
    }
  }, 80);
}

function tickBoss(boss, now) {
  if (!isEntityUsable(boss)) {
    states.delete(boss.id);
    return;
  }
  if (world.getDifficulty() === Difficulty.Peaceful) {
    states.delete(boss.id);
    attempt(() => boss.remove(), "despawn peaceful Obsidilith");
    return;
  }
  const state = states.get(boss.id) ?? initialize(boss, now);
  const health = boss.getComponent("minecraft:health");
  if (!health || health.currentValue <= 0) return;
  if (state.dying) {
    tickDeathSequence(boss, state, now);
    return;
  }
  if (now % 20 === 0) {
    attempt(() => boss.removeEffect("poison"), "remove Obsidilith poison");
    attempt(() => boss.removeEffect("wither"), "remove Obsidilith wither");
  }
  attempt(() => boss.clearVelocity(), "anchor Obsidilith between attacks");

  if (!state.awakened) {
    if (now < state.summonUntil) return;
    state.awakened = true;
    state.nextAttack = now + 49;
    setAnimation(boss, OBSIDILITH_ANIMATION_STATE.idle);
  }

  refreshShield(boss, state, now);
  const players = playersNear(boss);
  recordTargetPositions(state.positionHistory, players, now);
  if (state.shielded) tickShieldEffects(boss, state, now);

  if (state.currentAttack) {
    const captured = players.find((player) => player.id === state.attackData.targetId);
    const fallback = selectCombatTarget(boss, players, state, now, false);
    tickAttack(boss, state, captured ?? fallback, now);
    return;
  }

  if (players.length === 0) {
    clearCurrentTarget(state);
    if (!state.shielded) {
      setAnimation(boss, OBSIDILITH_ANIMATION_STATE.idle);
      setEnergy(boss, false);
    }
    healWhileIdle(boss, health);
    return;
  }

  let target = selectCombatTarget(boss, players, state, now, false);
  if (!target) return;
  if (distance(boss.location, state.home) > OBSIDILITH_LEASH_RADIUS) {
    attempt(() => boss.teleport(state.home), "return Obsidilith to arena");
    state.nextAttack = now + 50;
  }
  attempt(() => boss.lookAt(targetPoint(target)), "face Obsidilith combat target");

  if (state.shielded) {
    return;
  }

  if (state.pendingPillarDefense) {
    beginPillarDefense(boss, state, now);
    return;
  }
  if (now < state.nextAttack) return;
  target = selectCombatTarget(boss, players, state, now, true) ?? target;
  beginAttack(boss, state, target, chooseAttack(state, target, boss), now);
}

function armorAdjustedDamage(amount, armor) {
  const armorPoints = Math.min(20, Math.max(armor / 5, armor - amount / 2));
  return amount * (1 - armorPoints / 25);
}

function healthBand(ratio) {
  return HEALTH_MILESTONES.find((milestone) => milestone > ratio) ?? 1;
}

function flashHurt(boss, state) {
  state.hurtUntil = system.currentTick + 6;
  setHurt(boss, true);
  system.runTimeout(() => {
    if (!isEntityUsable(boss) || system.currentTick < state.hurtUntil) return;
    setHurt(boss, false);
  }, 6);
}

function registerDamageEvents() {
  if (damageEventsRegistered) return;
  damageEventsRegistered = true;
  world.beforeEvents.entityHurt.subscribe((event) => {
    const boss = event.hurtEntity;
    if (!isEntityUsable(boss) || boss.typeId !== OBSIDILITH_TYPE) return;
    const state = states.get(boss.id);
    if (event.damageSource.damagingEntity?.id === boss.id || event.damageSource.cause === EntityDamageCause.fall) {
      event.cancel = true;
      return;
    }
    if (state?.dying) {
      if (state.finalizingDeath) return;
      event.cancel = true;
      return;
    }
    // The rune phase is an absolute shield in Java: only destroying every
    // active rune re-enables damage to the boss.
    if (state?.shielded) {
      event.cancel = true;
      const attacker = event.damageSource.damagingEntity;
      const isProjectile = event.damageSource.damagingProjectile !== undefined ||
        event.damageSource.cause === EntityDamageCause.projectile;
      system.run(() => {
        if (!isEntityUsable(boss)) return;
        spawnBurst(boss.dimension, boss.location, 18, 2.5, OBSIDILITH_PILLAR_RUNE_PARTICLE);
        playSound(boss.dimension, "bomd.nether_gauntlet.energy_shield", boss.location, 1, 0.75 + Math.random() * 0.2);
        if (!isProjectile && isEntityUsable(attacker) && attacker.typeId === "minecraft:player") {
          const direction = normalize({
            x: attacker.location.x - boss.location.x,
            y: 0,
            z: attacker.location.z - boss.location.z
          });
          attempt(
            () => attacker.applyKnockback({ x: direction.x * 0.5, z: direction.z * 0.5 }, 0.15),
            "repel Obsidilith shield attacker"
          );
        }
      });
      return;
    }

    const rawDamage = event.damage;
    const armor = state?.currentTargetId ? 14 : 24;
    const adjustedDamage = armorAdjustedDamage(rawDamage, armor);
    const health = boss.getComponent("minecraft:health");
    if (state && health && adjustedDamage >= health.currentValue) {
      event.cancel = true;
      state.dying = true;
      system.run(() => startDeathSequence(boss, state));
      return;
    }
    if (state && health) {
      const maximum = Math.max(1, health.effectiveMax);
      const beforeBand = healthBand(health.currentValue / maximum);
      const afterBand = healthBand(
        Math.max(0, health.currentValue - adjustedDamage) / maximum
      );
      if (beforeBand !== afterBand) state.pendingPillarDefense = true;
    }
    event.damage = adjustedDamage;
    const attacker = event.damageSource.damagingEntity;
    if (state && isEntityUsable(attacker) && attacker.typeId === "minecraft:player") {
      rememberPlayerDamage(state, attacker, rawDamage, system.currentTick);
    }
    if (state) system.run(() => flashHurt(boss, state));
  });
}

export function startObsidilithManager() {
  if (started) return;
  started = true;
  registerDamageEvents();
  system.runInterval(() => {
    // Natural Obsidilith arenas belong in the End, but the boss itself must
    // remain fully functional when spawned by commands or test workflows in
    // any vanilla dimension. The Java entity AI is not dimension-gated.
    for (const dimensionId of ["overworld", "nether", "the_end"]) {
      const dimension = attempt(
        () => world.getDimension(dimensionId),
        `resolve Obsidilith manager dimension ${dimensionId}`
      );
      if (!dimension) continue;
      for (const boss of dimension.getEntities({ type: OBSIDILITH_TYPE })) {
        runSafely(() => tickBoss(boss, system.currentTick), "tick Java-faithful Obsidilith manager");
      }
    }
  }, 1);
}

export function forgetObsidilith(id) {
  states.delete(id);
}
