// @ts-check

import { OBSIDILITH_ANVIL_INDICATOR_PARTICLE, OBSIDILITH_ANVIL_TRAIL_PARTICLE } from "../../../core/config.js";
import { attempt, isEntityUsable } from "../../../core/safe.js";
import { playSound, spawnBurst, spawnParticle } from "../../../visuals/frost.js";
import { damagePlayersAt, discGroundPoints, groundAt } from "../rift-system.js";

function targetPoint(target) {
  const collision = attempt(() => target.getComponent("minecraft:collision_box"), "read Anvil target bounds");
  const height = typeof collision?.height === "number" ? collision.height : 1.8;
  return { x: target.location.x, y: target.location.y + height * 0.5, z: target.location.z };
}

export function tickAnvil(boss, data, target, elapsed) {
  if (elapsed === 20 && !data.teleported) {
    data.teleported = true;
    const targetLocation = isEntityUsable(target) ? target.location : data.target;
    const impact = groundAt(boss.dimension, targetLocation) ?? {
      x: targetLocation.x,
      y: targetLocation.y,
      z: targetLocation.z
    };
    data.impact = impact;
    data.above = { x: targetLocation.x, y: targetLocation.y + 24, z: targetLocation.z };
    const facingLocation = isEntityUsable(target) ? targetPoint(target) : targetLocation;
    attempt(() => boss.teleport(data.above, { facingLocation }), "teleport Obsidilith above Anvil target");
    playSound(boss.dimension, "bomd.obsidilith.teleport", data.above, 3, 1);
    for (const point of discGroundPoints(boss.dimension, impact, 2)) {
      spawnParticle(boss.dimension, OBSIDILITH_ANVIL_INDICATOR_PARTICLE, point);
    }
  } else if (elapsed > 20 && elapsed < 48 && data.impact && data.above) {
    const progress = Math.min(1, (elapsed - 20) / 28);
    const eased = progress * progress;
    attempt(() => boss.teleport({
      x: data.impact.x,
      y: data.above.y + (data.impact.y - data.above.y) * eased,
      z: data.impact.z
    }), "drop Obsidilith during Anvil attack");
    if (elapsed % 3 === 0) spawnParticle(boss.dimension, OBSIDILITH_ANVIL_TRAIL_PARTICLE, boss.location);
  } else if (elapsed === 48 && data.impact && !data.landed) {
    data.landed = true;
    attempt(() => boss.teleport(data.impact), "land Obsidilith Anvil attack");
    const exploded = attempt(() => {
      boss.dimension.createExplosion(data.impact, 4, {
        breaksBlocks: true,
        causesFire: false,
        source: boss
      });
      return true;
    }, "create Obsidilith Anvil explosion") === true;
    if (!exploded) damagePlayersAt(boss, data.impact, { radius: 5, amount: 20, knockup: 1.1 });
    spawnBurst(boss.dimension, data.impact, 24, 5, OBSIDILITH_ANVIL_TRAIL_PARTICLE);
    playSound(boss.dimension, "bomd.obsidilith.burst", data.impact, 1.8, 0.78);
  } else if (elapsed === 68 && data.returnPosition && !data.returned) {
    data.returned = true;
    attempt(() => boss.teleport(data.returnPosition), "return Obsidilith after Anvil attack");
    playSound(boss.dimension, "bomd.obsidilith.teleport", data.returnPosition, 1.3, 1.15);
  }
}
