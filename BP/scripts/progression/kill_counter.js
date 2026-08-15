// @ts-check

import { ItemStack, world } from "@minecraft/server";
import {
  SOUL_FLAME_PARTICLE,
  SOUL_KILLS_PROPERTY,
  SOUL_STAR_ITEM,
  SOUL_STAR_KILL_INTERVAL
} from "../core/config.js";
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
          killingPlayer.sendMessage(
            "§b[BOMD] §fYou gathered the first of 50 valid souls. Zombies, skeletons, drowned, husks, phantoms, strays, Wither creatures, and their variants count toward a Soul Star."
          ),
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
                ? "§bThe souls converge... §f1 valid creature remaining"
                : `§bSoul Star progress §7— §f${progress}/${SOUL_STAR_KILL_INTERVAL}`
            ),
          "show soul star progress"
        );
      }
      return;
    }

    const location = {
      x: event.deadEntity.location.x,
      y: event.deadEntity.location.y + 0.6,
      z: event.deadEntity.location.z
    };
    attempt(
      () =>
        event.deadEntity.dimension.spawnItem(
          new ItemStack(SOUL_STAR_ITEM, 1),
          location
        ),
      "drop soul star"
    );
    spawnBurst(
      event.deadEntity.dimension,
      location,
      28,
      1.1,
      SOUL_FLAME_PARTICLE
    );
    playSound(
      event.deadEntity.dimension,
      "bomd.night_lich.soul_star",
      location,
      1,
      1
    );
    attempt(
      () =>
        killingPlayer.sendMessage(
          `§b[BOMD] §fYour ${count}th valid kill released a Soul Star. Use it in the air to locate a tower, or place four on its altars.`
        ),
      "announce soul star"
    );
  });
}
