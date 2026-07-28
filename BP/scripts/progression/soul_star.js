// @ts-check

import { ItemStack, system, world } from "@minecraft/server";
import {
  ALTAR_BLOCK,
  SOUL_STAR_ITEM,
  SOUL_STAR_WISP_TYPE,
  SPARKLE_PARTICLE
} from "../core/config.js";
import { translate } from "../core/i18n.js";
import { attempt, isEntityUsable, schedule } from "../core/safe.js";
import { clampEntityLocation, dimensionHeightRange } from "../core/world_bounds.js";
import { distance, horizontalDistance } from "../core/vector.js";
import { playSound, spawnParticle } from "../visuals/frost.js";
import { consumeSelectedItem, isCreative } from "./inventory.js";
import { resolveSoulStarTowerTarget } from "./night_lich_tower_locator.js";

const activeWisps = new Map();
const activePlayers = new Set();
let tickerStarted = false;

function directionKey(from, to) {
  const angle =
    (Math.atan2(to.z - from.z, to.x - from.x) * 180) / Math.PI;
  const directions = ["e", "se", "s", "sw", "w", "nw", "n", "ne"];
  return directions[
    Math.round(((angle + 360) % 360) / 45) % directions.length
  ];
}

function safeReturnLocation(dimension, endpoint) {
  const range = dimensionHeightRange(dimension);
  const start = clampEntityLocation(dimension, endpoint, 0.75);
  const maxDistance = Math.max(1, Math.min(16, start.y - range.min));
  const hit = attempt(
    () => dimension.getBlockFromRay(start, { x: 0, y: -1, z: 0 }, {
      maxDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false
    }),
    "find Soul Star return ground"
  );
  if (!hit?.block?.location) return start;
  return clampEntityLocation(dimension, {
    x: start.x,
    y: hit.block.location.y + 1.15,
    z: start.z
  }, 0.25);
}

function giveSoulStarDirectly(state, stack) {
  const player = world.getEntity(state.playerId);
  if (!isEntityUsable(player) || player.typeId !== "minecraft:player") return false;
  const container = attempt(
    () => player.getComponent("minecraft:inventory")?.container,
    "open inventory for Soul Star fallback"
  );
  if (!container) return false;
  const remainder = attempt(() => container.addItem(stack), "return Soul Star to inventory");
  if (!remainder) return true;
  const dropped = attempt(
    () => player.dimension.spawnItem(remainder, clampEntityLocation(player.dimension, {
      x: player.location.x,
      y: player.location.y + 1,
      z: player.location.z
    })),
    "drop Soul Star inventory remainder"
  );
  return isEntityUsable(dropped);
}

function returnSoulStar(state) {
  if (!state.returnItem) return;
  const stack = new ItemStack(SOUL_STAR_ITEM, 1);
  const location = safeReturnLocation(
    state.dimension,
    state.lastLocation ?? state.endpoint
  );
  const dropped = attempt(
    () => state.dimension.spawnItem(stack, location),
    "return Soul Star as dropped item"
  );
  if (!isEntityUsable(dropped)) {
    giveSoulStarDirectly(state, stack);
    return;
  }

  // Java drops the item where the travelling star finishes. Keep that visible
  // endpoint, then make the return deterministic so lava, unloaded ledges or
  // a missed pickup cannot consume the progression item permanently.
  schedule(30, () => {
    if (!isEntityUsable(dropped)) return;
    const player = world.getEntity(state.playerId);
    if (!isEntityUsable(player) || player.typeId !== "minecraft:player") return;
    if (player.dimension.id !== dropped.dimension.id) {
      attempt(() => dropped.remove(), "remove stranded Soul Star return");
      giveSoulStarDirectly(state, new ItemStack(SOUL_STAR_ITEM, 1));
      return;
    }
    attempt(
      () => dropped.teleport(clampEntityLocation(player.dimension, {
        x: player.location.x,
        y: player.location.y + 1,
        z: player.location.z
      })),
      "rescue returned Soul Star"
    );
  }, "move uncollected Soul Star to owner");

  schedule(70, () => {
    if (!isEntityUsable(dropped)) return;
    attempt(() => dropped.remove(), "finalize Soul Star return");
    giveSoulStarDirectly(state, new ItemStack(SOUL_STAR_ITEM, 1));
  }, "guarantee Soul Star inventory return");
}

function finishWisp(state) {
  const { wisp, dimension, endpoint, playerId } = state;
  const finishLocation = safeReturnLocation(
    dimension,
    state.lastLocation ?? endpoint
  );
  if (isEntityUsable(wisp)) {
    attempt(() => wisp.remove(), "remove soul star wisp");
  }
  state.lastLocation = finishLocation;
  returnSoulStar(state);
  spawnParticle(dimension, SPARKLE_PARTICLE, finishLocation);
  playSound(
    dimension,
    "bomd.night_lich.soul_star",
    finishLocation,
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
    const location = clampEntityLocation(state.dimension, {
      x: state.start.x + (state.endpoint.x - state.start.x) * eased,
      y: state.start.y + (state.endpoint.y - state.start.y) * eased + arc,
      z: state.start.z + (state.endpoint.z - state.start.z) * eased
    }, 0.25);
    state.lastLocation = location;

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

        activePlayers.add(player.id);
        player.onScreenDisplay.setActionBar(
          translate("bomd.message.soul_star.searching")
        );

        system.run(() => {
          resolveSoulStarTowerTarget(player)
            .then((result) => {
              if (!isEntityUsable(player) || player.typeId !== "minecraft:player") {
                activePlayers.delete(player.id);
                return;
              }
              if (result.status === "wrong_dimension") {
                activePlayers.delete(player.id);
                player.sendMessage(
                  translate("bomd.message.soul_star.wrong_dimension")
                );
                return;
              }
              if (result.status !== "found" || !result.target) {
                activePlayers.delete(player.id);
                player.sendMessage(
                  translate("bomd.message.soul_star.search_failed")
                );
                return;
              }

              if (result.target.dimension.id !== player.dimension.id) {
                activePlayers.delete(player.id);
                player.sendMessage(
                  translate("bomd.message.soul_star.wrong_dimension")
                );
                return;
              }
              const towerLocation = result.target.location;
              const start = player.getHeadLocation();
              const horizontal = horizontalDistance(start, towerLocation);
              const travel = Math.min(12, Math.max(1, horizontal));
              const dx = towerLocation.x - start.x;
              const dz = towerLocation.z - start.z;
              const divisor = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
              const endpoint = clampEntityLocation(player.dimension, {
                x: start.x + (dx / divisor) * travel,
                y: start.y + 8,
                z: start.z + (dz / divisor) * travel
              }, 0.75);
              const returnItem = !isCreative(player);
              if (!consumeSelectedItem(player, SOUL_STAR_ITEM)) {
                activePlayers.delete(player.id);
                return;
              }

              const wisp = attempt(
                () => player.dimension.spawnEntity(SOUL_STAR_WISP_TYPE, start),
                "spawn soul star wisp"
              );
              if (!isEntityUsable(wisp)) {
                activePlayers.delete(player.id);
                if (returnItem) {
                  giveSoulStarDirectly(
                    { playerId: player.id },
                    new ItemStack(SOUL_STAR_ITEM, 1)
                  );
                }
                return;
              }

              activeWisps.set(wisp.id, {
                wisp,
                wispId: wisp.id,
                playerId: player.id,
                dimension: player.dimension,
                start,
                endpoint,
                startTick: system.currentTick,
                duration: 46,
                lastLocation: start,
                returnItem
              });
              playSound(
                player.dimension,
                "random.bow",
                player.location,
                0.7,
                0.55
              );
              const range = Math.round(distance(player.location, towerLocation));
              player.onScreenDisplay.setActionBar(
                translate(
                  `bomd.message.soul_star.direction.${directionKey(
                    player.location,
                    towerLocation
                  )}`,
                  [range]
                )
              );
            })
            .catch((error) => {
              activePlayers.delete(player.id);
              if (isEntityUsable(player)) {
                player.sendMessage(
                  translate("bomd.message.soul_star.search_failed")
                );
              }
              console.warn(`[BOMD] Soul Star locator failed: ${String(error)}`);
            });
        });
      }
    }
  );

  if (!tickerStarted) {
    tickerStarted = true;
    system.runInterval(tickWisps, 1);
  }
}
