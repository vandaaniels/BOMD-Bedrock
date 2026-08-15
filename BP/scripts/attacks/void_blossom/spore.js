// @ts-check

import {
  VOID_ANIMATION_STATE,
  VOID_SPORE_TYPE
} from "../../core/config.js";
import { targetCenter } from "../gauntlet/shared.js";
import { launchProjectile } from "../../projectiles/spawn_projectile.js";
import { subtract } from "../../core/vector.js";
import { playSound } from "../../visuals/frost.js";
import { setVoidAnimation, voidProjectileOrigin } from "./shared.js";

export const voidSpore = {
  id: "spore",
  duration: 100,
  recovery: 0,
  start({ boss }) {
    setVoidAnimation(boss, VOID_ANIMATION_STATE.spore);
  },
  tick({ boss, target, elapsed }) {
    if (elapsed === 26) {
      playSound(boss.dimension, "bomd.void_blossom.spore_prepare", boss.location, 1.5, 1);
    }
    if (elapsed !== 45) return;
    const origin = voidProjectileOrigin(boss, 9.25, 2.8);
    launchProjectile({
      boss,
      typeId: VOID_SPORE_TYPE,
      origin,
      direction: subtract(targetCenter(target), origin),
      speed: 0.75,
      lifetimeTicks: 100
    });
  },
  finish({ boss }) {
    setVoidAnimation(boss, VOID_ANIMATION_STATE.idle);
  }
};
