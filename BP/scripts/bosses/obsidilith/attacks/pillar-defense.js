// @ts-check

import {
  OBSIDILITH_PILLAR_RUNE_PARTICLE,
  OBSIDILITH_RUNE_BLOCK
} from "../../../core/config.js";
import { attempt } from "../../../core/safe.js";
import { distance } from "../../../core/vector.js";
import { playSound, spawnBurst } from "../../../visuals/frost.js";
import { groundAt } from "../rift-system.js";
import { telegraphPillarSpawn } from "../visual-effects.js";

export function findPillarPositions(boss) {
  const positions = [];
  const keys = new Set();
  for (let attemptIndex = 0; attemptIndex < 16 && positions.length < 4; attemptIndex += 1) {
    const angle = Math.random() * Math.PI * 2;
    const ground = groundAt(boss.dimension, {
      x: boss.location.x + Math.cos(angle) * 13,
      y: boss.location.y,
      z: boss.location.z + Math.sin(angle) * 13
    });
    if (!ground || Math.abs(ground.blockY - boss.location.y) > 15) continue;
    const key = `${ground.blockX},${ground.blockY},${ground.blockZ}`;
    if (keys.has(key)) continue;
    keys.add(key);
    // PillarAction starts at the supporting surface block (the first
    // obsidian replaces it), then places the second obsidian and the rune.
    const position = { x: ground.blockX, y: ground.blockY - 1, z: ground.blockZ };
    positions.push(position);
    telegraphPillarSpawn(boss, position);
  }
  return positions;
}

export function buildPillars(boss, positions) {
  const runes = [];
  for (const position of positions) {
    for (let height = 0; height < 2; height += 1) {
      attempt(
        () => boss.dimension.getBlock({
          x: position.x,
          y: position.y + height,
          z: position.z
        })?.setType("minecraft:obsidian"),
        "build Obsidilith shield pillar"
      );
    }
    const rune = { x: position.x, y: position.y + 2, z: position.z };
    const placed = attempt(() => {
      boss.dimension.getBlock(rune)?.setType(OBSIDILITH_RUNE_BLOCK);
      return boss.dimension.getBlock(rune)?.typeId === OBSIDILITH_RUNE_BLOCK;
    }, "place Obsidilith shield rune") === true;
    if (!placed) continue;
    runes.push(rune);
    spawnBurst(boss.dimension, {
      x: rune.x + 0.5,
      y: rune.y + 0.5,
      z: rune.z + 0.5
    }, 18, 1.1, OBSIDILITH_PILLAR_RUNE_PARTICLE);
    playSound(boss.dimension, "dig.basalt", rune, 1.2, 0.8);
  }
  return runes;
}

export function activeRunes(boss, runePositions) {
  return runePositions.filter((position) => {
    const nearEnough = distance(boss.location, {
      x: position.x + 0.5,
      y: position.y + 0.5,
      z: position.z + 0.5
    }) <= 64;
    if (!nearEnough) return false;
    return attempt(
      () => boss.dimension.getBlock(position)?.typeId === OBSIDILITH_RUNE_BLOCK,
      "check Obsidilith shield rune"
    ) === true;
  });
}
