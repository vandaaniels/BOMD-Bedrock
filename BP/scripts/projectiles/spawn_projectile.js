// @ts-check

import { system } from "@minecraft/server";
import {
  attempt,
  isEntityUsable,
  runSafely
} from "../core/safe.js";
import { add, normalize, scale } from "../core/vector.js";

function isFiniteVector(vector) {
  return (
    vector &&
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    Number.isFinite(vector.z)
  );
}

export function launchProjectile({
  boss,
  typeId,
  origin,
  direction,
  speed,
  lifetimeTicks = 180
}) {
  if (!isEntityUsable(boss)) {
    return undefined;
  }

  const normalizedDirection = normalize(direction);
  if (
    !isFiniteVector(origin) ||
    !isFiniteVector(normalizedDirection) ||
    !Number.isFinite(speed) ||
    speed <= 0
  ) {
    console.warn(`[BOMD] Invalid launch data for ${typeId}.`);
    return undefined;
  }

  const spawnLocation = add(
    origin,
    scale(normalizedDirection, 0.2)
  );
  const projectile = attempt(
    () => boss.dimension.spawnEntity(typeId, spawnLocation),
    `spawn projectile ${typeId}`
  );
  if (!isEntityUsable(projectile)) {
    return undefined;
  }

  const component = attempt(
    () => projectile.getComponent("minecraft:projectile"),
    `read projectile component ${typeId}`
  );
  if (!component) {
    attempt(() => projectile.remove(), "remove invalid projectile");
    return undefined;
  }

  const launched = runSafely(
    () => {
      component.owner = boss;
      component.shoot(scale(normalizedDirection, speed));
    },
    `launch projectile ${typeId}`
  );
  if (!launched) {
    attempt(() => projectile.remove(), "remove failed projectile");
    return undefined;
  }

  system.runTimeout(() => {
    if (isEntityUsable(projectile)) {
      attempt(() => projectile.remove(), "expire projectile");
    }
  }, lifetimeTicks);

  return projectile;
}
