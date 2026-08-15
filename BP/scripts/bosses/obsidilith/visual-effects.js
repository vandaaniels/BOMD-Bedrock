// @ts-check

import { system } from "@minecraft/server";
import {
  OBSIDILITH_PILLAR_RUNE_PARTICLE,
  OBSIDILITH_PILLAR_SPAWN_PARTICLE
} from "../../core/config.js";
import { isEntityUsable } from "../../core/safe.js";
import { spawnParticle } from "../../visuals/frost.js";

export function chargeAura(boss, particle, count = 36) {
  for (let index = 0; index < count; index += 1) {
    const angle = index * Math.PI * 2 / count;
    const radius = 2.6 + (index % 3) * 0.25;
    spawnParticle(boss.dimension, particle, {
      x: boss.location.x + Math.cos(angle) * radius,
      y: boss.location.y + 0.4 + (index % 6) * 0.55,
      z: boss.location.z + Math.sin(angle) * radius
    });
  }
}

function linePoints(start, end, count) {
  const points = [];
  const divisor = Math.max(1, count - 1);
  for (let index = 0; index < count; index += 1) {
    const progress = index / divisor;
    points.push({
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
      z: start.z + (end.z - start.z) * progress
    });
  }
  return points;
}

export function telegraphPillarSpawn(boss, position) {
  const eye = { x: boss.location.x, y: boss.location.y + 3.4, z: boss.location.z };
  const rune = { x: position.x + 0.5, y: position.y + 2.5, z: position.z + 0.5 };
  for (const point of linePoints(eye, rune, 13)) {
    spawnParticle(boss.dimension, OBSIDILITH_PILLAR_RUNE_PARTICLE, point);
  }
  for (let index = 0; index < 20; index += 1) {
    spawnParticle(boss.dimension, OBSIDILITH_PILLAR_SPAWN_PARTICLE, {
      x: position.x + 0.5 + (Math.random() - 0.5) * 0.6,
      y: position.y + 5 + Math.random() * 3,
      z: position.z + 0.5 + (Math.random() - 0.5) * 0.6
    });
  }
}

export function drawShieldLink(boss, position) {
  const start = { x: position.x + 0.5, y: position.y + 0.5, z: position.z + 0.5 };
  const end = { x: boss.location.x, y: boss.location.y + 3.4, z: boss.location.z };
  linePoints(start, end, 15).forEach((point, index) => {
    system.runTimeout(() => {
      if (isEntityUsable(boss)) {
        spawnParticle(boss.dimension, OBSIDILITH_PILLAR_RUNE_PARTICLE, point);
      }
    }, index);
  });
}
