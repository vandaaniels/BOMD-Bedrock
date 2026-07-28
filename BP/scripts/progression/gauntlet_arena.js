// @ts-check

import { world } from "@minecraft/server";
import { GAUNTLET_BLOCK_DEBRIS_PARTICLE, GAUNTLET_TYPE } from "../core/gauntlet_config.js";
import { translate } from "../core/i18n.js";
import { attempt, isEntityUsable, schedule } from "../core/safe.js";
import { registerStructureLocation } from "./structure_locator.js";
import { isLocationLoaded } from "../core/world_bounds.js";
import {
  playGauntletSound,
  spawnGauntletBurst,
  spawnGauntletParticle
} from "../visuals/nether_gauntlet.js";

const CORE_BLOCK = "bomd:gauntlet_blackstone";
const SEALED_BLOCK = "bomd:sealed_blackstone";
const CORE_COMPONENT = "bomd:gauntlet_summon";
const CARDINAL_OFFSETS = Object.freeze([
  Object.freeze({ x: 1, y: 0, z: 0 }),
  Object.freeze({ x: -1, y: 0, z: 0 }),
  Object.freeze({ x: 0, y: 0, z: 1 }),
  Object.freeze({ x: 0, y: 0, z: -1 })
]);
const activeCores = new Set();
const registeredArenaCenters = new Set();
let registered = false;

function add(location, offset) {
  return {
    x: location.x + offset.x,
    y: location.y + offset.y,
    z: location.z + offset.z
  };
}

function coreKey(dimension, location) {
  return `${dimension.id}:${location.x}:${location.y}:${location.z}`;
}


function arenaCenterFromCore(block) {
  const candidates = [
    block.location,
    ...CARDINAL_OFFSETS.map((offset) => ({
      x: block.location.x - offset.x,
      y: block.location.y,
      z: block.location.z - offset.z
    }))
  ];
  for (const candidate of candidates) {
    const centerBlock = attempt(
      () => block.dimension.getBlock(candidate),
      "inspect Nether Gauntlet arena center"
    );
    if (centerBlock?.typeId !== CORE_BLOCK) continue;
    const complete = CARDINAL_OFFSETS.every((offset) => {
      const arm = attempt(
        () => block.dimension.getBlock(add(candidate, offset)),
        "inspect Nether Gauntlet arena arm"
      );
      return arm?.typeId === CORE_BLOCK;
    });
    if (complete) return candidate;
  }
  return undefined;
}

function registerArenaFromCore(block) {
  const center = arenaCenterFromCore(block);
  if (!center) return false;
  const key = coreKey(block.dimension, center);
  if (registeredArenaCenters.has(key)) return true;
  if (registeredArenaCenters.size >= 2048) registeredArenaCenters.clear();
  registeredArenaCenters.add(key);
  return registerStructureLocation("nether_gauntlet", block.dimension, {
    x: center.x + 0.5,
    y: center.y,
    z: center.z + 0.5
  });
}

function neighboringCore(dimension, location) {
  for (const offset of CARDINAL_OFFSETS) {
    const candidate = attempt(
      () => dimension.getBlock(add(location, offset)),
      "find Nether Gauntlet arena core"
    );
    if (candidate?.typeId === CORE_BLOCK) {
      return candidate;
    }
  }
  return undefined;
}

function existingBoss(dimension, location) {
  return dimension
    .getEntities({ type: GAUNTLET_TYPE, location, maxDistance: 32 })
    .find(isEntityUsable);
}

function dissolveCageLayer(dimension, center, layer, retry = 0) {
  const layerCenter = { x: center.x + 0.5, y: center.y + layer + 0.5, z: center.z + 0.5 };
  if (!isLocationLoaded(dimension, layerCenter)) {
    if (retry < 60) {
      schedule(10, () => dissolveCageLayer(dimension, center, layer, retry + 1), "resume Nether Gauntlet cage layer");
    }
    return;
  }
  for (let x = -1; x <= 1; x += 1) {
    for (let z = -1; z <= 1; z += 1) {
      const block = attempt(
        () => dimension.getBlock({ x: center.x + x, y: center.y + layer, z: center.z + z }),
        "read Nether Gauntlet cage block"
      );
      if (block?.typeId !== SEALED_BLOCK && block?.typeId !== CORE_BLOCK) continue;
      const debrisLocation = {
        x: block.location.x + 0.5,
        y: block.location.y + 0.5,
        z: block.location.z + 0.5
      };
      spawnGauntletParticle(dimension, GAUNTLET_BLOCK_DEBRIS_PARTICLE, debrisLocation);
      spawnGauntletParticle(dimension, "bomd:gauntlet_spark", debrisLocation);
      attempt(() => block.setType("minecraft:air"), "remove Nether Gauntlet cage block");
      playGauntletSound(dimension, "dig.stone", debrisLocation, 0.42, 0.72 + Math.random() * 0.22);
    }
  }
  playGauntletSound(
    dimension,
    "bomd.nether_gauntlet.cast",
    layerCenter,
    0.65,
    0.8 + (layer + 1) * 0.055
  );
}

function dissolveCage(dimension, center) {
  for (let layer = -1; layer <= 4; layer += 1) {
    schedule(10 + layer * 5, () => dissolveCageLayer(dimension, center, layer), "dissolve Nether Gauntlet cage layer");
  }
}

function activateArena(core, player) {
  const center = { ...core.location };
  registerStructureLocation("nether_gauntlet", core.dimension, { x: center.x + 0.5, y: center.y, z: center.z + 0.5 });
  const key = coreKey(core.dimension, center);
  if (activeCores.has(key) || existingBoss(core.dimension, center)) {
    player?.sendMessage(translate("bomd.message.gauntlet.already_active"));
    return;
  }
  activeCores.add(key);
  schedule(200, () => activeCores.delete(key), "release Gauntlet arena lock");

  const spawnLocation = {
    x: center.x + 0.5,
    y: center.y - 0.5,
    z: center.z + 0.5
  };
  const boss = attempt(
    () => core.dimension.spawnEntity(GAUNTLET_TYPE, spawnLocation),
    "spawn Nether Gauntlet from arena core"
  );
  if (!isEntityUsable(boss)) {
    activeCores.delete(key);
    player?.sendMessage(translate("bomd.message.gauntlet.spawn_failed"));
    return;
  }

  boss.nameTag = "Nether Gauntlet";
  dissolveCage(core.dimension, center);
  spawnGauntletBurst(core.dimension, spawnLocation, 48, 2.2);
  playGauntletSound(
    core.dimension,
    "bomd.nether_gauntlet.cast",
    spawnLocation,
    1.4,
    0.72
  );
  world.sendMessage(translate("bomd.message.gauntlet.prison_opens"));
}

function handleCoreBreak(event) {
  const brokenBlock = event.block;
  const dimension = brokenBlock.dimension;
  const brokenLocation = { ...brokenBlock.location };
  const player = event.player;
  // onPlayerBreak is emitted after the selected block becomes aire. The
  // surviving adjacent arm identifies the center block of the five-block cross.
  schedule(
    1,
    () => {
      const core = neighboringCore(dimension, brokenLocation);
      if (core) {
        activateArena(core, player);
      }
    },
    "activate broken Nether Gauntlet core"
  );
}

function sparkleCore(block) {
  if (Math.random() > 0.36) {
    return;
  }
  spawnGauntletParticle(block.dimension, "bomd:gauntlet_spark", {
    x: block.location.x + 0.2 + Math.random() * 0.6,
    y: block.location.y + 0.2 + Math.random() * 0.6,
    z: block.location.z + 0.2 + Math.random() * 0.6
  });
}

export function registerGauntletArenaEvents(blockComponentRegistry) {
  if (registered) {
    return;
  }
  registered = true;
  blockComponentRegistry.registerCustomComponent(CORE_COMPONENT, {
    onPlayerBreak: handleCoreBreak,
    onTick(event) {
      registerArenaFromCore(event.block);
      sparkleCore(event.block);
    }
  });

}
