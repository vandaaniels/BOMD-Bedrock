// @ts-check

import {
  VOID_ANIMATION_STATE,
  VOID_BLADE_TYPE
} from "../../core/config.js";
import { rotateY, subtract } from "../../core/vector.js";
import { launchProjectile } from "../../projectiles/spawn_projectile.js";
import { playSound } from "../../visuals/frost.js";
import { setVoidAnimation, voidProjectileOrigin } from "./shared.js";

const VOLLEY_TICKS = Object.freeze([28, 52, 75]);

function fireBladeLine(boss, target) {
  const origin = voidProjectileOrigin(boss, 9.55, 2.8);
  const targetCenter = {
    x: target.location.x,
    y: target.location.y + 1,
    z: target.location.z
  };
  const toward = subtract(targetCenter, origin);
  const side = rotateY({ x: toward.x, y: 0, z: toward.z }, Math.random() < 0.5 ? 20 : -20);
  const horizontal = Math.sqrt(side.x * side.x + side.z * side.z) || 1;
  const lateral = { x: side.x / horizontal, y: 0, z: side.z / horizontal };
  for (let index = 0; index < 11; index += 1) {
    const offset = -7 + index * 1.4;
    const destination = {
      x: targetCenter.x + lateral.x * offset,
      y: targetCenter.y,
      z: targetCenter.z + lateral.z * offset
    };
    launchProjectile({
      boss,
      typeId: VOID_BLADE_TYPE,
      origin,
      direction: subtract(destination, origin),
      speed: 0.9,
      lifetimeTicks: 80
    });
  }
  playSound(boss.dimension, "bomd.void_blossom.petal_blade", boss.location, 3, 0.94 + Math.random() * 0.12);
}

export const voidBlade = {
  id: "blade",
  duration: 120,
  recovery: 0,
  start({ boss }) {
    setVoidAnimation(boss, VOID_ANIMATION_STATE.blade);
  },
  tick({ boss, target, elapsed }) {
    if (VOLLEY_TICKS.includes(elapsed)) fireBladeLine(boss, target);
  },
  finish({ boss }) {
    setVoidAnimation(boss, VOID_ANIMATION_STATE.idle);
  }
};
