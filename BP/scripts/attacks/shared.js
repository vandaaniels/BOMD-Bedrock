// @ts-check

import { isEntityUsable } from "../core/safe.js";

export function contextActive(context, requireTarget = true) {
  if (!isEntityUsable(context.boss)) {
    return false;
  }
  if (requireTarget && !isEntityUsable(context.target)) {
    return false;
  }
  return typeof context.isCurrent !== "function" || context.isCurrent();
}
