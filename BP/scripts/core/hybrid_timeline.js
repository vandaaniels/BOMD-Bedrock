// @ts-check

import { system } from "@minecraft/server";
import { attempt, isEntityUsable } from "./safe.js";

const GAUNTLET_TIMELINE_ID = "bomd:gauntlet_timeline";
const LICH_TIMELINE_ID = "bomd:lich_timeline";

/** @type {((entity:any, message:string)=>void) | undefined} */
let gauntletHandler;
/** @type {((entity:any, message:string)=>void) | undefined} */
let lichHandler;
let started = false;

export const GAUNTLET_SERVER_ATTACK = Object.freeze({
  idle: 0,
  punch: 1,
  swirl_punch: 2,
  laser: 3,
  blindness: 4
});

export const LICH_SERVER_ATTACK = Object.freeze({
  idle: 0,
  magic_missile_volley: 1,
  comet: 2,
  summon_phantoms: 3,
  teleport: 4,
  rage_comets: 5,
  rage_missiles: 6,
  rage_minions: 7
});

export function setGauntletTimelineHandler(handler) {
  gauntletHandler = handler;
}

export function setLichTimelineHandler(handler) {
  lichHandler = handler;
}

export function setGauntletServerAttack(entity, attackId) {
  if (!isEntityUsable(entity)) return false;
  const value = GAUNTLET_SERVER_ATTACK[attackId] ?? 0;
  return attempt(() => {
    entity.setProperty("bomd:server_attack", value);
    return true;
  }, `set Gauntlet server attack ${attackId}`) === true;
}

export function setLichServerAttack(entity, attackId) {
  if (!isEntityUsable(entity)) return false;
  const value = LICH_SERVER_ATTACK[attackId] ?? 0;
  return attempt(() => {
    entity.setProperty("bomd:server_attack", value);
    return true;
  }, `set Night Lich server attack ${attackId}`) === true;
}

export function startHybridTimelineBridge() {
  if (started) return;
  started = true;
  system.afterEvents.scriptEventReceive.subscribe((event) => {
    const entity = event.sourceEntity;
    if (!isEntityUsable(entity)) return;
    if (event.id === GAUNTLET_TIMELINE_ID) {
      attempt(() => gauntletHandler?.(entity, event.message ?? ""), "dispatch Gauntlet behavior timeline");
      return;
    }
    if (event.id === LICH_TIMELINE_ID) {
      attempt(() => lichHandler?.(entity, event.message ?? ""), "dispatch Night Lich behavior timeline");
    }
  });
}
