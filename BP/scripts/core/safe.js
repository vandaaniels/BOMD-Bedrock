// @ts-check

import { system } from "@minecraft/server";

function isTransientLocationError(error) {
  const text = String(error);
  return text.includes("LocationInUnloadedChunkError") || text.includes("LocationOutOfWorldBoundariesError");
}

export function isEntityUsable(entity) {
  return entity !== undefined && entity !== null && entity.isValid;
}

export function schedule(delayTicks, callback, label = "scheduled task") {
  return system.runTimeout(() => {
    try {
      callback();
    } catch (error) {
      if (!isTransientLocationError(error)) console.warn(`[BOMD] ${label} failed: ${String(error)}`);
    }
  }, Math.max(1, Math.floor(delayTicks)));
}

export function attempt(callback, label = "operation") {
  try {
    return callback();
  } catch (error) {
    if (!isTransientLocationError(error)) console.warn(`[BOMD] ${label} failed: ${String(error)}`);
    return undefined;
  }
}

export function runSafely(callback, label = "operation") {
  try {
    callback();
    return true;
  } catch (error) {
    if (!isTransientLocationError(error)) console.warn(`[BOMD] ${label} failed: ${String(error)}`);
    return false;
  }
}
