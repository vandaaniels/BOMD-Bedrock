// @ts-check

import { ItemStack, system, world } from "@minecraft/server";
import {
  ALTAR_BLOCK,
  ANCHOR_TYPE,
  SOUL_STAR_ITEM,
  SOUL_STAR_WISP_TYPE,
  SPARKLE_PARTICLE,
  TOWER_DEFEATED_PROPERTY
} from "../core/config.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import { distance, horizontalDistance } from "../core/vector.js";
import { playSound, spawnParticle } from "../visuals/frost.js";
import { consumeSelectedItem, isCreative } from "./inventory.js";
import { planNearestNightLichTower } from "./tower_locator.js";

const activeWisps = new Map();
const activePlayers = new Set();
let tickerStarted = false;

function nearestAvailableTower(player) {
  const overworld = world.getDimension("overworld");
  const anchors = attempt(
    () =>
      overworld.getEntities({
        type: ANCHOR_TYPE,
        location: player.location,
        maxDistance: 4096
      }),
    "find Night Lich towers"
  ) ?? [];

  return anchors
    .filter(
      (anchor) =>
        isEntityUsable(anchor) &&
        anchor.getDynamicProperty(TOWER_DEFEATED_PROPERTY) !== true
    )
    .sort(
      (left, right) =>
        distance(left.location, player.location) -
        distance(right.location, player.location)
    )[0]?.location;
}

function directionName(from, to) {
  const angle =
    (Math.atan2(to.z - from.z, to.x - from.x) * 180) / Math.PI;
  const directions = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  return directions[
    Math.round(((angle + 360) % 360) / 45) % directions.length
  ];
}

function finishWisp(state) {
  const { wisp, dimension, endpoint, playerId, returnItem } = state;
  if (isEntityUsable(wisp)) {
    attempt(() => wisp.remove(), "remove soul star wisp");
  }
  if (returnItem) {
    attempt(
      () => dimension.spawnItem(new ItemStack(SOUL_STAR_ITEM, 1), endpoint),
      "return soul star"
    );
  }
  playSound(
    dimension,
    "bomd.night_lich.soul_star",
    endpoint,
    1,
    0.95 + Math.random() * 0.1
  );
  activePlayers.delete(playerId);
  activeWisps.delete(state.wispId);
}

function tickWisps() {
  const now = system.currentTick;
  for (const state of activeWisps.values()) {
    if (!isEntityUsable(state.wisp)) {
      finishWisp(state);
      continue;
    }

    const progress = Math.min(1, (now - state.startTick) / state.duration);
    const eased = 1 - Math.pow(1 - progress, 2);
    const arc = Math.sin(progress * Math.PI) * 2.25;
    const location = {
      x: state.start.x + (state.endpoint.x - state.start.x) * eased,
      y: state.start.y + (state.endpoint.y - state.start.y) * eased + arc,
      z: state.start.z + (state.endpoint.z - state.start.z) * eased
    };

    attempt(
      () =>
        state.wisp.teleport(location, {
          facingLocation: state.endpoint
        }),
      "move soul star wisp"
    );
    spawnParticle(state.dimension, SPARKLE_PARTICLE, location);

    const spiralAngle = (now - state.startTick) * 0.52;
    spawnParticle(state.dimension, SPARKLE_PARTICLE, {
      x: location.x + Math.cos(spiralAngle) * 0.25,
      y: location.y,
      z: location.z + Math.sin(spiralAngle) * 0.25
    });

    if (progress >= 1) {
      finishWisp(state);
    }
  }
}

export function registerSoulStarLocator(itemComponentRegistry) {
  itemComponentRegistry.registerCustomComponent(
    "bomd:soul_star_locator",
    {
      onUse(event) {
        const player = event.source;
        if (!isEntityUsable(player) || activePlayers.has(player.id)) {
          return;
        }
        if (player.dimension.id !== "minecraft:overworld") {
          player.onScreenDisplay.setActionBar(
            "§bThe Soul Star can only search for the tower in the Overworld"
          );
          return;
        }
        const aimedBlock = attempt(
          () =>
            player.dimension.getBlockFromRay(
              player.getHeadLocation(),
              player.getViewDirection(),
              {
                maxDistance: 6,
                includeLiquidBlocks: false,
                includePassableBlocks: false
              }
            )?.block,
          "check Soul Star altar target"
        );
        if (aimedBlock?.typeId === ALTAR_BLOCK) {
          return;
        }

        const towerLocation =
          nearestAvailableTower(player) ??
          planNearestNightLichTower(player.location);
        if (!towerLocation) {
          player.sendMessage(
            "§c[BOMD] No Night Lich tower location could be reserved in this world."
          );
          return;
        }

        const start = player.getHeadLocation();
        const horizontal = horizontalDistance(start, towerLocation);
        const travel = Math.min(12, Math.max(1, horizontal));
        const dx = towerLocation.x - start.x;
        const dz = towerLocation.z - start.z;
        const divisor = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
        const endpoint = {
          x: start.x + (dx / divisor) * travel,
          y: start.y + 8,
          z: start.z + (dz / divisor) * travel
        };
        const returnItem = !isCreative(player);
        if (!consumeSelectedItem(player, SOUL_STAR_ITEM)) {
          return;
        }

        const wisp = attempt(
          () => player.dimension.spawnEntity(SOUL_STAR_WISP_TYPE, start),
          "spawn soul star wisp"
        );
        if (!isEntityUsable(wisp)) {
          if (returnItem) {
            player.dimension.spawnItem(
              new ItemStack(SOUL_STAR_ITEM, 1),
              player.location
            );
          }
          return;
        }

        activePlayers.add(player.id);
        activeWisps.set(wisp.id, {
          wisp,
          wispId: wisp.id,
          playerId: player.id,
          dimension: player.dimension,
          start,
          endpoint,
          startTick: system.currentTick,
          duration: 46,
          returnItem
        });
        playSound(
          player.dimension,
          "random.bow",
          player.location,
          0.7,
          0.55
        );
        const range = Math.round(
          horizontalDistance(player.location, towerLocation)
        );
        player.onScreenDisplay.setActionBar(
          `§bThe Soul Star points ${directionName(
            player.location,
            towerLocation
          )} §7— §f${range} blocks`
        );
      }
    }
  );

  if (!tickerStarted) {
    tickerStarted = true;
    system.runInterval(tickWisps, 1);
  }
}
