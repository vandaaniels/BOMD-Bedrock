// @ts-check

import {
  GameMode,
  system,
  world
} from "@minecraft/server";
import {
  ANCHOR_TYPE,
  BOSS_TYPE,
  BRIMSTONE_NECTAR_ITEM,
  CHARGED_ENDER_PEARL_ITEM,
  CHARGED_ENDER_PEARL_TYPE,
  CHARGED_PEARL_OWNER_PROPERTY,
  EARTHDIVE_SPEAR_ITEM,
  GAUNTLET_SEALED_BLOCK,
  GAUNTLET_SEAL_BLOCK,
  GAUNTLET_TYPE,
  LICH_PHANTOM_TYPE,
  LEVITATION_BLOCK,
  MOB_WARD_BLOCK,
  MONOLITH_BLOCK,
  OBSIDILITH_TYPE,
  VOID_BLOSSOM_ANCHOR_TYPE,
  VOID_BLOSSOM_TYPE,
  VOID_POLLEN_PARTICLE
} from "../core/config.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import { distance, horizontalDistance, normalize } from "../core/vector.js";
import { launchProjectile } from "../projectiles/spawn_projectile.js";
import { playSound, spawnBurst, spawnParticle } from "../visuals/frost.js";
import { consumeSelectedItem, isCreative } from "./inventory.js";
import {
  nearestRecordedGauntletArena,
  recordGauntletArenaRepaired
} from "./gauntlet_locator.js";
import { nearestRecordedObsidilithArena, queueObsidilithArenaPlacement } from "./obsidilith.js";
import { resetTower } from "./tower.js";

const activeWards = new Map();
const activeMonoliths = new Map();
const chargedPearlReadyTickByPlayer = new Map();
const handledItemUseTickByKey = new Map();
const earthdiveStartTickByPlayer = new Map();
let subscribed = false;
let amplifyingExplosionUntil = -1;

function blockKey(block) {
  return `${block.dimension.id}:${block.location.x},${block.location.y},${block.location.z}`;
}

function rememberBlock(map, block) {
  map.set(blockKey(block), {
    dimensionId: block.dimension.id,
    location: {
      x: block.location.x + 0.5,
      y: block.location.y + 0.5,
      z: block.location.z + 0.5
    },
    tick: system.currentTick
  });
}

function cleanBlockCaches() {
  const cutoff = system.currentTick - 60;
  for (const map of [activeWards, activeMonoliths]) {
    for (const [key, entry] of map) {
      if (entry.tick < cutoff) map.delete(key);
    }
  }
}

function isMonster(entity) {
  const family = attempt(
    () => entity.getComponent("minecraft:type_family"),
    "read Mob Ward target family"
  );
  return family?.hasTypeFamily("monster") === true;
}

function wardBlocksSpawn(entity) {
  if (
    !isEntityUsable(entity) ||
    !isMonster(entity) ||
    [BOSS_TYPE, GAUNTLET_TYPE, LICH_PHANTOM_TYPE, VOID_BLOSSOM_TYPE].includes(entity.typeId) ||
    entity.hasTag("bomd:lich_minion") ||
    entity.hasTag("bomd:lich_tower_guard")
  ) return false;
  return [...activeWards.values()].some(
    (ward) =>
      ward.dimensionId === entity.dimension.id &&
      distance(ward.location, entity.location) <= 64
  );
}

function tickLevitationBlock(event) {
  const center = {
    x: event.block.location.x + 0.5,
    y: event.block.location.y + 0.7,
    z: event.block.location.z + 0.5
  };
  const players = event.dimension.getPlayers();
  for (const player of players) {
    if (horizontalDistance(player.location, center) > 3.5) continue;
    const mode = player.getGameMode();
    if (mode === GameMode.Spectator) continue;
    attempt(
      () => player.addEffect("slow_falling", 12, {
        amplifier: 0,
        showParticles: false
      }),
      "apply Table of Elevation slow fall"
    );
    const velocity = attempt(
      () => player.getVelocity(),
      "read Table of Elevation velocity"
    ) ?? { x: 0, y: 0, z: 0 };
    const desiredY = player.isJumping
      ? 0.26
      : player.isSneaking
        ? -0.16
        : 0.015;
    attempt(
      () => player.applyImpulse({
        x: 0,
        y: (desiredY - velocity.y) * 0.55,
        z: 0
      }),
      "control Table of Elevation player"
    );
    if (system.currentTick % 4 === 0) {
      for (let side = -1; side <= 1; side += 2) {
        spawnParticle(event.dimension, VOID_POLLEN_PARTICLE, {
          x: center.x + side * 3.1,
          y: player.location.y + 0.7,
          z: center.z + (Math.random() - 0.5) * 6
        });
      }
    }
  }
}

function registerBlockEvents(blockRegistry) {
  blockRegistry.registerCustomComponent("bomd:levitation_block", {
    onTick: tickLevitationBlock
  });
  blockRegistry.registerCustomComponent("bomd:mob_ward", {
    onTick(event) {
      rememberBlock(activeWards, event.block);
    }
  });
  blockRegistry.registerCustomComponent("bomd:monolith", {
    onTick(event) {
      rememberBlock(activeMonoliths, event.block);
    }
  });
}

function damageSelectedItem(player, typeId, amount) {
  if (isCreative(player)) return;
  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) return;
  const slot = player.selectedSlotIndex;
  const stack = inventory.getItem(slot);
  if (!stack || stack.typeId !== typeId) return;
  const durability = stack.getComponent("minecraft:durability");
  if (!durability) return;
  durability.damage = Math.min(durability.maxDurability, durability.damage + amount);
  if (durability.damage >= durability.maxDurability) {
    inventory.setItem(slot, undefined);
    playSound(player.dimension, "random.break", player.location, 1, 1);
  } else {
    inventory.setItem(slot, stack);
  }
}

function earthdiveDestination(player, originYOffset = 0) {
  const head = player.getHeadLocation();
  const origin = { x: head.x, y: head.y + originYOffset, z: head.z };
  const view = player.getViewDirection();
  const direction = normalize({ x: view.x, y: 0, z: view.z });
  if (Math.abs(direction.x) + Math.abs(direction.z) < 0.01) return undefined;
  const height = player.dimension.heightRange;
  const readBlock = (location) => {
    if (location.y < height.min || location.y >= height.max) return undefined;
    return attempt(
      () => player.dimension.getBlock({
        x: Math.floor(location.x),
        y: Math.floor(location.y),
        z: Math.floor(location.z)
      }),
      "read Earthdive wall block"
    );
  };
  let wallStart;
  for (let length = 0.5; length <= 6; length += 0.5) {
    const point = {
      x: origin.x + direction.x * length,
      y: origin.y + direction.y * length,
      z: origin.z + direction.z * length
    };
    const block = readBlock(point);
    if (!block) break;
    if (!block.isAir && !block.isLiquid) {
      wallStart = length;
      break;
    }
  }
  if (wallStart === undefined) return undefined;
  for (let length = wallStart + 0.5; length <= wallStart + 32; length += 0.5) {
    const point = {
      x: origin.x + direction.x * length,
      y: origin.y + direction.y * length,
      z: origin.z + direction.z * length
    };
    const block = readBlock(point);
    if (!block) break;
    if (!block.isAir || block.isLiquid) {
      continue;
    }
    const baseY = Math.floor(point.y) - 1;
    for (const yOffset of [0, -1, 1, -2, 2, -3, 3]) {
      const feetLocation = {
        x: Math.floor(point.x) + 0.5,
        y: baseY + yOffset,
        z: Math.floor(point.z) + 0.5
      };
      if (feetLocation.y <= height.min || feetLocation.y + 1 >= height.max) continue;
      const floor = readBlock({
        x: feetLocation.x,
        y: feetLocation.y - 1,
        z: feetLocation.z
      });
      const feet = readBlock(feetLocation);
      const destinationHead = readBlock({
        x: feetLocation.x,
        y: feetLocation.y + 1,
        z: feetLocation.z
      });
      if (
        floor && !floor.isAir && !floor.isLiquid &&
        feet?.isAir && !feet.isLiquid &&
        destinationHead?.isAir && !destinationHead.isLiquid
      ) return feetLocation;
    }
  }
  return undefined;
}

function useEarthdive(event) {
  const player = event.source;
  if (!isEntityUsable(player)) return;
  const destination =
    earthdiveDestination(player) ?? earthdiveDestination(player, -1);
  if (!destination) {
    player.onScreenDisplay.setActionBar("§8The spear cannot find an exit beyond the wall");
    return;
  }
  const facing = {
    x: destination.x + player.getViewDirection().x * 2,
    y: destination.y + 1,
    z: destination.z + player.getViewDirection().z * 2
  };
  attempt(
    () => player.teleport(destination, { facingLocation: facing }),
    "Earthdive Spear wall teleport"
  );
  damageSelectedItem(player, EARTHDIVE_SPEAR_ITEM, 1);
  player.startItemCooldown("bomd_earthdive", 20);
  spawnBurst(player.dimension, destination, 22, 1.2, VOID_POLLEN_PARTICLE);
  playSound(player.dimension, "bomd.items.earthdive", destination, 1, 0.92 + Math.random() * 0.16);
}

function dispatchItemUse(event, forcedTypeId, completeUse = false) {
  const player = event.source;
  if (!isEntityUsable(player) || player.typeId !== "minecraft:player") return;
  const typeId = event.itemStack?.typeId ?? forcedTypeId;
  if (!typeId) return;
  let handler;
  if (typeId === CHARGED_ENDER_PEARL_ITEM) {
    handler = useChargedPearl;
  } else if (typeId === EARTHDIVE_SPEAR_ITEM && completeUse) {
    handler = useEarthdive;
  } else if (typeId === BRIMSTONE_NECTAR_ITEM) {
    handler = useBrimstone;
  }
  if (!handler) return;
  const key = `${player.id}:${typeId}`;
  if (handledItemUseTickByKey.get(key) === system.currentTick) return;
  handledItemUseTickByKey.set(key, system.currentTick);
  handler(event);
}

function useChargedPearl(event) {
  const player = event.source;
  if (!isEntityUsable(player)) return;
  const readyTick = chargedPearlReadyTickByPlayer.get(player.id) ?? 0;
  if (system.currentTick < readyTick) return;
  chargedPearlReadyTickByPlayer.set(player.id, system.currentTick + 180);
  const origin = player.getHeadLocation();
  const projectile = launchProjectile({
    boss: player,
    typeId: CHARGED_ENDER_PEARL_TYPE,
    origin,
    direction: player.getViewDirection(),
    speed: 1.55,
    lifetimeTicks: 160
  });
  if (!projectile) {
    chargedPearlReadyTickByPlayer.delete(player.id);
    return;
  }
  attempt(
    () => projectile.setDynamicProperty(
      CHARGED_PEARL_OWNER_PROPERTY,
      player.id
    ),
    "store charged Ender Pearl owner"
  );
  player.startItemCooldown("bomd_charged_ender_pearl", 180);
  playSound(player.dimension, "random.bow", player.location, 0.8, 0.72);
}

function repairVoidCavern(anchor) {
  const center = { ...anchor.location };
  anchor.setDynamicProperty("bomd:void_defeated", false);
  system.runTimeout(() => {
    const existing = anchor.dimension.getEntities({
      type: VOID_BLOSSOM_TYPE,
      location: center,
      maxDistance: 48
    });
    if (existing.length > 0) return;
    const boss = attempt(
      () => anchor.dimension.spawnEntity(VOID_BLOSSOM_TYPE, center),
      "restore Void Blossom with Brimstone Nectar"
    );
    if (isEntityUsable(boss)) boss.nameTag = "Void Blossom";
  }, 60);
}

function repairGauntletCage(dimension, arenaCenter) {
  const center = {
    x: Math.floor(arenaCenter.x),
    y: 17,
    z: Math.floor(arenaCenter.z)
  };
  for (let x = -1; x <= 1; x += 1) {
    for (let z = -1; z <= 1; z += 1) {
      for (let y = 0; y <= 4; y += 1) {
        attempt(
          () => dimension.getBlock({
            x: center.x + x,
            y: center.y + y,
            z: center.z + z
          })?.setType(GAUNTLET_SEALED_BLOCK),
          "restore Nether Gauntlet cage"
        );
      }
    }
  }
  for (const offset of [
    { x: 0, z: 0 },
    { x: -1, z: 0 },
    { x: 1, z: 0 },
    { x: 0, z: -1 },
    { x: 0, z: 1 }
  ]) {
    attempt(
      () => dimension.getBlock({
        x: center.x + offset.x,
        y: center.y + 1,
        z: center.z + offset.z
      })?.setType(GAUNTLET_SEAL_BLOCK),
      "restore Nether Gauntlet seal"
    );
  }
  recordGauntletArenaRepaired(arenaCenter);
}

function repairObsidilithArena(dimension, arenaCenter) {
  queueObsidilithArenaPlacement(dimension, {
    x: Math.floor(arenaCenter.x),
    y: Math.floor(arenaCenter.y) - 46,
    z: Math.floor(arenaCenter.z)
  });
}

function useBrimstone(event) {
  const player = event.source;
  if (!isEntityUsable(player)) return;
  const dimension = player.dimension;
  const lichAnchor = dimension.getEntities({
    type: ANCHOR_TYPE,
    location: player.location,
    maxDistance: 48
  }).sort((a, b) => distance(a.location, player.location) - distance(b.location, player.location))[0];
  const voidAnchor = dimension.getEntities({
    type: VOID_BLOSSOM_ANCHOR_TYPE,
    location: player.location,
    maxDistance: 48
  }).sort((a, b) => distance(a.location, player.location) - distance(b.location, player.location))[0];
  const gauntletCenter = dimension.id === "minecraft:nether"
    ? nearestRecordedGauntletArena(player.location, 40)
    : undefined;
  const obsidilithCenter = dimension.id === "minecraft:the_end"
    ? nearestRecordedObsidilithArena(player.location, 64)
    : undefined;
  const lichAlive = isEntityUsable(lichAnchor) && dimension.getEntities({
    type: BOSS_TYPE,
    location: lichAnchor.location,
    maxDistance: 96
  }).length > 0;
  const voidAlive = isEntityUsable(voidAnchor) && dimension.getEntities({
    type: VOID_BLOSSOM_TYPE,
    location: voidAnchor.location,
    maxDistance: 96
  }).length > 0;
  const gauntletAlive = gauntletCenter && dimension.getEntities({
    type: GAUNTLET_TYPE,
    location: gauntletCenter,
    maxDistance: 96
  }).length > 0;
  const obsidilithAlive = obsidilithCenter && dimension.getEntities({
    type: OBSIDILITH_TYPE,
    location: obsidilithCenter,
    maxDistance: 96
  }).length > 0;
  const candidates = [
    isEntityUsable(lichAnchor) && !lichAlive
      ? { type: "lich", entity: lichAnchor, location: lichAnchor.location }
      : undefined,
    isEntityUsable(voidAnchor) && !voidAlive
      ? { type: "void", entity: voidAnchor, location: voidAnchor.location }
      : undefined,
    gauntletCenter && !gauntletAlive
      ? { type: "gauntlet", location: gauntletCenter }
      : undefined,
    obsidilithCenter && !obsidilithAlive
      ? { type: "obsidilith", location: obsidilithCenter }
      : undefined
  ].filter(Boolean).sort(
    (a, b) => distance(a.location, player.location) - distance(b.location, player.location)
  );
  const chosen = candidates[0];
  if (!chosen) {
    player.onScreenDisplay.setActionBar("§cNo defeated boss structure is nearby");
    return;
  }
  if (!consumeSelectedItem(player, BRIMSTONE_NECTAR_ITEM)) return;
  const effectLocation = { ...chosen.location };
  system.runTimeout(() => {
    if (chosen.type === "lich") {
      resetTower(chosen.entity);
    } else if (chosen.type === "void") {
      repairVoidCavern(chosen.entity);
    } else {
      if (chosen.type === "gauntlet") repairGauntletCage(dimension, chosen.location);
      if (chosen.type === "obsidilith") repairObsidilithArena(dimension, chosen.location);
    }
    spawnBurst(dimension, effectLocation, 42, 3, VOID_POLLEN_PARTICLE);
  }, 30);
  player.startItemCooldown("bomd_brimstone", 80);
  playSound(dimension, "bomd.items.brimstone", player.location, 1, 0.94 + Math.random() * 0.12);
}

function registerItemEvents(itemRegistry) {
  itemRegistry.registerCustomComponent("bomd:crystal_fruit", {
    onConsume(event) {
      const entity = event.source;
      if (!isEntityUsable(entity)) return;
      entity.addEffect("regeneration", 300, { amplifier: 1, showParticles: true });
      entity.addEffect("instant_health", 1, { amplifier: 0, showParticles: true });
      entity.addEffect("resistance", 600, { amplifier: 0, showParticles: true });
    }
  });
  itemRegistry.registerCustomComponent("bomd:charged_ender_pearl", {
    onUse(event) {
      dispatchItemUse(event, CHARGED_ENDER_PEARL_ITEM);
    }
  });
  itemRegistry.registerCustomComponent("bomd:earthdive_spear", {
    onUse(event) {
      if (event.source.typeId === "minecraft:player") {
        earthdiveStartTickByPlayer.set(event.source.id, system.currentTick);
      }
    },
    onCompleteUse(event) {
      dispatchItemUse(event, EARTHDIVE_SPEAR_ITEM, true);
    },
    onHitEntity(event) {
      if (event.attackingEntity.typeId === "minecraft:player") {
        damageSelectedItem(event.attackingEntity, EARTHDIVE_SPEAR_ITEM, 1);
      }
    },
    onMineBlock(event) {
      if (event.source.typeId === "minecraft:player") {
        damageSelectedItem(event.source, EARTHDIVE_SPEAR_ITEM, 2);
      }
    }
  });
  itemRegistry.registerCustomComponent("bomd:brimstone_nectar", {
    onUse(event) {
      dispatchItemUse(event, BRIMSTONE_NECTAR_ITEM);
    }
  });
}

function subscribeGlobalEvents() {
  if (subscribed) return;
  subscribed = true;
  world.afterEvents.entitySpawn.subscribe((event) => {
    system.run(() => {
      if (wardBlocksSpawn(event.entity) && isEntityUsable(event.entity)) {
        spawnBurst(event.entity.dimension, event.entity.location, 8, 0.5, VOID_POLLEN_PARTICLE);
        attempt(() => event.entity.remove(), "Mob Ward suppress spawned monster");
      }
    });
  });
  world.afterEvents.itemUse.subscribe((event) => {
    dispatchItemUse(event);
  });
  world.afterEvents.itemCompleteUse?.subscribe((event) => {
    dispatchItemUse(event, undefined, true);
  });
  world.afterEvents.itemStartUse?.subscribe((event) => {
    if (event.itemStack?.typeId === EARTHDIVE_SPEAR_ITEM) {
      earthdiveStartTickByPlayer.set(event.source.id, system.currentTick);
    }
  });
  world.afterEvents.itemReleaseUse?.subscribe((event) => {
    if (event.itemStack?.typeId !== EARTHDIVE_SPEAR_ITEM) return;
    const started = earthdiveStartTickByPlayer.get(event.source.id);
    const charged = event.useDuration <= 0 ||
      (started !== undefined && system.currentTick - started >= 10);
    earthdiveStartTickByPlayer.delete(event.source.id);
    if (charged) dispatchItemUse(event, EARTHDIVE_SPEAR_ITEM, true);
  });
  world.afterEvents.itemStopUse?.subscribe((event) => {
    if (event.itemStack?.typeId !== EARTHDIVE_SPEAR_ITEM) return;
    const started = earthdiveStartTickByPlayer.get(event.source.id);
    const charged = event.useDuration <= 0 ||
      (started !== undefined && system.currentTick - started >= 10);
    earthdiveStartTickByPlayer.delete(event.source.id);
    if (charged) dispatchItemUse(event, EARTHDIVE_SPEAR_ITEM, true);
  });
  world.afterEvents.explosion.subscribe((event) => {
    if (system.currentTick <= amplifyingExplosionUntil) return;
    const impacted = event.getImpactedBlocks();
    const location = impacted.length > 0
      ? impacted.reduce(
          (sum, block) => ({
            x: sum.x + block.location.x / impacted.length,
            y: sum.y + block.location.y / impacted.length,
            z: sum.z + block.location.z / impacted.length
          }),
          { x: 0, y: 0, z: 0 }
        )
      : isEntityUsable(event.source)
        ? { ...event.source.location }
        : undefined;
    if (!location) return;
    const amplified = [...activeMonoliths.values()].some(
      (entry) =>
        entry.dimensionId === event.dimension.id &&
        distance(entry.location, location) <= 64
    );
    if (!amplified) return;
    amplifyingExplosionUntil = system.currentTick + 1;
    system.run(() => attempt(
      () => event.dimension.createExplosion(location, 1.25, {
        breaksBlocks: false,
        causesFire: false,
        source: isEntityUsable(event.source) ? event.source : undefined
      }),
      "apply Bedrock Blast Amplifier pulse"
    ));
  });
  system.runInterval(cleanBlockCaches, 40);
}

export function registerArtifactComponents(itemRegistry, blockRegistry) {
  registerItemEvents(itemRegistry);
  registerBlockEvents(blockRegistry);
  subscribeGlobalEvents();
}
