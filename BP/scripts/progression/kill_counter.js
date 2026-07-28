// @ts-check

import { ItemStack, world } from "@minecraft/server";
import {
  SOUL_FLAME_PARTICLE,
  SOUL_KILLS_PROPERTY,
  SOUL_STAR_ITEM,
  SOUL_STAR_KILL_INTERVAL
} from "../core/config.js";
import { translate } from "../core/i18n.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import { playSound, spawnBurst } from "../visuals/frost.js";

const COUNTED_UNDEAD = new Set([
  "minecraft:zombie",
  "minecraft:skeleton",
  "minecraft:drowned",
  "minecraft:giant",
  "minecraft:husk",
  "minecraft:phantom",
  "minecraft:skeleton_horse",
  "minecraft:stray",
  "minecraft:wither",
  "minecraft:wither_skeleton",
  "minecraft:zoglin",
  "minecraft:zombie_horse",
  "minecraft:zombie_villager",
  "minecraft:zombified_piglin"
]);

let registered = false;

function resolveKillingPlayer(damageSource) {
  const direct = damageSource.damagingEntity;
  if (isEntityUsable(direct) && direct.typeId === "minecraft:player") {
    return direct;
  }

  const owner = attempt(
    () =>
      damageSource.damagingProjectile
        ?.getComponent("minecraft:projectile")
        ?.owner,
    "resolve Soul Star projectile killer"
  );
  return isEntityUsable(owner) && owner.typeId === "minecraft:player"
    ? owner
    : undefined;
}

export function registerSoulKillCounter() {
  if (registered) {
    return;
  }
  registered = true;

  world.afterEvents.entityDie.subscribe((event) => {
    if (!COUNTED_UNDEAD.has(event.deadEntity.typeId)) {
      return;
    }

    const player = resolveKillingPlayer(event.damageSource);
    if (!isEntityUsable(player)) {
      return;
    }
    const killingPlayer =
      /** @type {import("@minecraft/server").Player} */ (player);

    const stored = attempt(
      () => killingPlayer.getDynamicProperty(SOUL_KILLS_PROPERTY),
      "read soul kill count"
    );
    const count = (typeof stored === "number" ? stored : 0) + 1;
    attempt(
      () => killingPlayer.setDynamicProperty(SOUL_KILLS_PROPERTY, count),
      "store soul kill count"
    );

    const progress = count % SOUL_STAR_KILL_INTERVAL;
    if (count === 1) {
      attempt(
        () =>
          killingPlayer.sendMessage(translate("bomd.message.soul_counter.first")),
        "explain soul star progression"
      );
    }
    if (progress !== 0) {
      const remaining = SOUL_STAR_KILL_INTERVAL - progress;
      if (progress % 10 === 0 || remaining === 1) {
        attempt(
          () =>
            killingPlayer.onScreenDisplay.setActionBar(
              remaining === 1
                ? translate("bomd.message.soul_counter.one_remaining")
                : translate("bomd.message.soul_counter.progress", [progress, SOUL_STAR_KILL_INTERVAL])
            ),
          "show soul star progress"
        );
      }
      return;
    }

    const corpseLocation = attempt(
      () => ({ ...event.deadEntity.location }),
      "read soul reward corpse location"
    );
    const rewardDimension = attempt(
      () => event.deadEntity.dimension,
      "read soul reward corpse dimension"
    ) ?? killingPlayer.dimension;
    const location = corpseLocation
      ? { x: corpseLocation.x, y: corpseLocation.y + 0.6, z: corpseLocation.z }
      : { x: killingPlayer.location.x, y: killingPlayer.location.y + 0.6, z: killingPlayer.location.z };
    attempt(
      () => rewardDimension.spawnItem(
        new ItemStack(SOUL_STAR_ITEM, 1),
        location
      ),
      "drop soul star"
    );
    spawnBurst(
      rewardDimension,
      location,
      28,
      1.1,
      SOUL_FLAME_PARTICLE
    );
    playSound(
      rewardDimension,
      "bomd.night_lich.soul_star",
      location,
      1,
      1
    );
    attempt(
      () =>
        killingPlayer.sendMessage(translate("bomd.message.soul_counter.reward", [count])),
      "announce soul star"
    );
  });
}
