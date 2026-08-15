// @ts-check

import { EntityDamageCause } from "@minecraft/server";
import { isBossCombatPlayer } from "../../core/combat_target.js";
import {
  VOID_ATTACK_DAMAGE,
  VOID_PETAL_PARTICLE,
  VOID_SPIKE_INDICATOR_PARTICLE,
  VOID_SPIKE_PARTICLE,
  VOID_WAVE_INDICATOR_PARTICLE
} from "../../core/config.js";
import { attempt, isEntityUsable } from "../../core/safe.js";
import { horizontalDistance, normalize } from "../../core/vector.js";
import { spawnParticle } from "../../visuals/frost.js";

export function setVoidAnimation(boss, value) {
  if (!isEntityUsable(boss)) return;
  attempt(
    () => boss.setProperty("bomd:void_animation_state", value),
    "set Void Blossom animation"
  );
  const energy = value === 7
    ? 0
    : value === 2 || value === 5
      ? 3
      : value === 0
        ? 1
        : 2;
  attempt(
    () => boss.setProperty("bomd:void_energy", energy),
    "set Void Blossom attack glow"
  );
}

export function setVoidStage(boss, value) {
  if (!isEntityUsable(boss)) return;
  attempt(
    () => boss.setProperty("bomd:void_stage", value),
    "set Void Blossom stage"
  );
}

export function voidPlayers(dimension, center, radius) {
  return (
    attempt(
      () => dimension.getPlayers({ location: center, maxDistance: radius }),
      "query Void Blossom players"
    ) ?? []
  ).filter(isBossCombatPlayer);
}

export function voidProjectileOrigin(
  boss,
  verticalOffset,
  forwardOffset = 2.75
) {
  const view = attempt(
    () => boss.getViewDirection(),
    "read Void Blossom projectile direction"
  ) ?? { x: 0, y: 0, z: 1 };
  const forward = normalize({ x: view.x, y: 0, z: view.z });
  return {
    x: boss.location.x + forward.x * forwardOffset,
    y: boss.location.y + verticalOffset,
    z: boss.location.z + forward.z * forwardOffset
  };
}

export function damageVoidPlayer(player, boss, amount = VOID_ATTACK_DAMAGE) {
  if (!isEntityUsable(player) || !isEntityUsable(boss)) return false;
  return attempt(
    () => player.applyDamage(amount, {
      cause: EntityDamageCause.entityAttack,
      damagingEntity: boss
    }),
    "apply Void Blossom attack damage"
  ) === true;
}

export function markVoidHit(state, player, key, now, immunityTicks = 10) {
  state.hitCooldowns ??= new Map();
  const id = `${key}:${player.id}`;
  const previous = state.hitCooldowns.get(id) ?? -9999;
  if (now - previous < immunityTicks) return false;
  state.hitCooldowns.set(id, now);
  return true;
}

export function groundPoint(dimension, point, fallbackY) {
  const x = Math.floor(point.x) + 0.5;
  const z = Math.floor(point.z) + 0.5;
  const startY = Math.floor(point.y ?? fallbackY) + 2;
  for (let y = startY; y >= startY - 8; y -= 1) {
    const block = attempt(
      () => dimension.getBlock({ x, y, z }),
      "find Void Blossom attack floor"
    );
    if (block && !block.isAir && !block.isLiquid) {
      return { x, y: y + 1.02, z };
    }
  }
  return { x, y: fallbackY, z };
}

function sampledDisc(center, radius, count) {
  const points = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) {
    const distance = radius * Math.sqrt((index + 0.5) / count);
    const angle = index * goldenAngle;
    points.push({
      x: center.x + Math.cos(angle) * distance,
      y: center.y,
      z: center.z + Math.sin(angle) * distance
    });
  }
  return points;
}

function spawnVoidSpikeFx(dimension, point) {
  const fx = attempt(
    () => dimension.spawnEntity("bomd:void_spike_fx", point),
    "spawn Void Blossom geometric spike"
  );
  if (!isEntityUsable(fx)) return;
  attempt(
    () => fx.teleport(point, {
      rotation: { x: 0, y: Math.random() * 360 }
    }),
    "rotate Void Blossom geometric spike"
  );
}

function blockDisc(center, radius) {
  const points = [];
  const integerRadius = Math.ceil(radius);
  const radiusSquared = radius * radius;
  for (let x = -integerRadius; x <= integerRadius; x += 1) {
    for (let z = -integerRadius; z <= integerRadius; z += 1) {
      if (x * x + z * z > radiusSquared) continue;
      points.push({
        x: center.x + x,
        y: center.y,
        z: center.z + z
      });
    }
  }
  return points;
}

export function telegraphDisc(dimension, center, radius, wave = false) {
  const particle = wave
    ? VOID_WAVE_INDICATOR_PARTICLE
    : VOID_SPIKE_INDICATOR_PARTICLE;
  const points = wave
    ? sampledDisc(
        center,
        radius,
        Math.min(180, Math.max(32, Math.ceil(radius * 5)))
      )
    : blockDisc(center, radius);
  for (const point of points) {
    spawnParticle(dimension, particle, point);
  }
}

export function eruptDisc(dimension, center, radius) {
  // Small targeted bursts are cheap enough to render each Java block-circle
  // spike as actual temporary geometry; particles become secondary accents.
  for (const point of blockDisc(center, radius)) {
    spawnVoidSpikeFx(dimension, point);
    spawnParticle(dimension, VOID_SPIKE_PARTICLE, point);
  }
}

export function eruptAnnulus(dimension, center, innerRadius, outerRadius) {
  // Java can render hundreds of client-only spike meshes without networking an
  // entity for every block. Bedrock cannot. Use geometric anchors around the
  // annulus plus the existing dense particle field; damage remains the exact
  // server-side annulus and is never tied to these visuals.
  const areaScale = outerRadius * outerRadius - innerRadius * innerRadius;
  const count = Math.min(220, Math.max(48, Math.ceil(areaScale * 0.8)));
  const geometryCount = Math.min(36, Math.max(12, Math.ceil(outerRadius * 1.4)));
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) {
    const factor = (index + 0.5) / count;
    const radius = Math.sqrt(
      innerRadius * innerRadius +
      (outerRadius * outerRadius - innerRadius * innerRadius) * factor
    );
    const angle = index * goldenAngle;
    const point = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y,
      z: center.z + Math.sin(angle) * radius
    };
    spawnParticle(dimension, VOID_SPIKE_PARTICLE, point);
  }
  for (let index = 0; index < geometryCount; index += 1) {
    const angle = index * Math.PI * 2 / geometryCount + innerRadius * 0.13;
    const radius = innerRadius + (outerRadius - innerRadius) * (0.35 + 0.5 * ((index % 3) / 2));
    spawnVoidSpikeFx(dimension, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y,
      z: center.z + Math.sin(angle) * radius
    });
  }
}

export function damageDisc(boss, center, radius, key, state, now) {
  for (const player of voidPlayers(boss.dimension, center, radius + 1.5)) {
    if (
      horizontalDistance(player.location, center) <= radius + 0.65 &&
      Math.abs(player.location.y - center.y) <= 3.2 &&
      markVoidHit(state, player, key, now)
    ) {
      damageVoidPlayer(player, boss);
    }
  }
}

export function damageAnnulus(
  boss,
  center,
  innerRadius,
  outerRadius,
  key,
  state,
  now
) {
  for (const player of voidPlayers(
    boss.dimension,
    center,
    outerRadius + 1.5
  )) {
    const radius = horizontalDistance(player.location, center);
    if (
      radius >= Math.max(0, innerRadius - 0.9) &&
      radius <= outerRadius + 0.9 &&
      Math.abs(player.location.y - center.y) <= 3.2 &&
      markVoidHit(state, player, key, now)
    ) {
      damageVoidPlayer(player, boss);
    }
  }
}

export function petalBurst(dimension, center, count = 12) {
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count;
    spawnParticle(dimension, VOID_PETAL_PARTICLE, {
      x: center.x + Math.cos(angle) * 0.8,
      y: center.y + (index % 4) * 0.22,
      z: center.z + Math.sin(angle) * 0.8
    });
  }
}
