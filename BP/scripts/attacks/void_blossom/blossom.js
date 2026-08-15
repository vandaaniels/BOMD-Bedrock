// @ts-check

import {
  VINE_WALL_BLOCK,
  VOID_ANIMATION_STATE,
  VOID_BLOSSOM_BLOCK,
  VOID_HEALER_OWNER_PROPERTY
} from "../../core/config.js";
import { attempt } from "../../core/safe.js";
import {
  protectedBlossomCount,
  voidBlossomOffsets
} from "../../core/void_blossom_logic.js";
import { playSound } from "../../visuals/frost.js";
import { groundPoint, petalBurst, setVoidAnimation } from "./shared.js";

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function placeVineGuard(dimension, location) {
  for (let x = -1; x <= 1; x += 1) {
    for (let z = -1; z <= 1; z += 1) {
      if (x === 0 && z === 0) continue;
      for (let y = 0; y <= 2; y += 1) {
        const block = attempt(
          () => dimension.getBlock({
            x: location.x + x,
            y: location.y + y,
            z: location.z + z
          }),
          "read Void Blossom vine guard"
        );
        if (block?.isAir) {
          attempt(() => block.setType(VINE_WALL_BLOCK), "place vine wall");
        }
      }
    }
  }
}

function placeHealingBlossom(boss, state, location, protectedPosition) {
  const dimension = boss.dimension;
  const below = dimension.getBlock({
    x: location.x,
    y: location.y - 1,
    z: location.z
  });
  const flower = dimension.getBlock(location);
  if (!below || !flower) return;

  if (below.isAir || below.typeId === "minecraft:water") {
    below.setType("minecraft:moss_block");
  }
  if (!flower.isAir && flower.typeId !== "minecraft:short_grass") return;
  flower.setType(VOID_BLOSSOM_BLOCK);
  state.healerLocations ??= [];
  state.healerLocations.push({ ...location });
  // The owner is held by the encounter state; this marker is useful to
  // migration/debug tools and does not make the block itself tick globally.
  boss.setDynamicProperty(VOID_HEALER_OWNER_PROPERTY, boss.id);
  petalBurst(dimension, location, 16);
  playSound(dimension, "bomd.void_blossom.petal_blade", location, 1, 0.9 + Math.random() * 0.2);
  if (protectedPosition) placeVineGuard(dimension, location);
}

export const voidBlossomAction = {
  id: "blossom",
  duration: 120,
  recovery: 0,
  start({ boss, state }) {
    const health = boss.getComponent("minecraft:health");
    const ratio = health
      ? health.currentValue / Math.max(1, health.effectiveMax)
      : 1;
    state.attackData.protectedCount = protectedBlossomCount(ratio);
    state.attackData.positions = shuffled(
      voidBlossomOffsets().map((offset) =>
        groundPoint(
          boss.dimension,
          {
            x: boss.location.x + offset.x,
            y: boss.location.y + 3,
            z: boss.location.z + offset.z
          },
          boss.location.y
        )
      )
    ).map((point) => ({
      x: Math.floor(point.x),
      y: Math.floor(point.y),
      z: Math.floor(point.z)
    }));
    setVoidAnimation(boss, VOID_ANIMATION_STATE.blossom);
    playSound(boss.dimension, "bomd.void_blossom.wave_indicator", boss.location, 2, 0.7);
  },
  tick({ boss, state, elapsed }) {
    if (elapsed < 40 || (elapsed - 40) % 8 !== 0) return;
    const index = (elapsed - 40) / 8;
    if (index < 0 || index >= 8) return;
    const location = state.attackData.positions[index];
    if (!location) return;
    attempt(
      () => placeHealingBlossom(
        boss,
        state,
        location,
        index < state.attackData.protectedCount
      ),
      "place Void Blossom healing flower"
    );
  },
  finish({ boss }) {
    setVoidAnimation(boss, VOID_ANIMATION_STATE.idle);
  }
};
