// @ts-check

import { system } from "@minecraft/server";
import { GAUNTLET_PART, gauntletObbs } from "./gauntlet_hitboxes.js";
import { attempt, isEntityUsable } from "./safe.js";
import { isLocationLoaded } from "./world_bounds.js";

export const GAUNTLET_PROXY_TYPE = "bomd:gauntlet_hitbox_proxy";
export const GAUNTLET_USE_HITBOX_PROXIES = true;
const PARENT_PROPERTY = "bomd:proxy_parent";
const PART_PROPERTY = "bomd:proxy_part";
const proxiesByBossId = new Map();

const EVENT_BY_PART = Object.freeze({
  [GAUNTLET_PART.EYE]: "bomd:set_eye",
  [GAUNTLET_PART.PALM]: "bomd:set_palm",
  [GAUNTLET_PART.FINGERS]: "bomd:set_fingers",
  [GAUNTLET_PART.THUMB]: "bomd:set_thumb",
  [GAUNTLET_PART.PINKY]: "bomd:set_pinky",
  [GAUNTLET_PART.FIST]: "bomd:set_fist"
});

function removeProxy(proxy) {
  if (isEntityUsable(proxy)) attempt(() => proxy.remove(), "remove Gauntlet hitbox proxy");
}

export function removeGauntletProxies(bossId) {
  const proxies = proxiesByBossId.get(bossId);
  if (proxies) for (const proxy of proxies.values()) removeProxy(proxy);
  proxiesByBossId.delete(bossId);
}

function spawnProxy(boss, part, center) {
  if (!isLocationLoaded(boss.dimension, center, 0.01)) return undefined;
  const proxy = attempt(
    () => boss.dimension.spawnEntity(GAUNTLET_PROXY_TYPE, center),
    `spawn Gauntlet ${part} proxy`
  );
  if (!isEntityUsable(proxy)) return undefined;
  proxy.setDynamicProperty(PARENT_PROPERTY, boss.id);
  proxy.setDynamicProperty(PART_PROPERTY, part);
  const eventId = EVENT_BY_PART[part];
  if (eventId) attempt(() => proxy.triggerEvent(eventId), `configure Gauntlet ${part} proxy`);
  return proxy;
}

export function updateGauntletProxies(boss, eyeOpen) {
  if (!GAUNTLET_USE_HITBOX_PROXIES || !isEntityUsable(boss)) return;
  if (!isLocationLoaded(boss.dimension, boss.location, 0.01)) return;
  // Axis-aligned Bedrock proxy boxes cannot reproduce the thin, rotated palm
  // and finger OBBs. Those large proxies overlapped the eye and intercepted
  // arrows aimed correctly at it. Keep only a dedicated eye proxy; the real
  // boss collision and scripted OBB test continue to reject body hits.
  const boxes = gauntletObbs(boss, eyeOpen, 0).filter((box) => box.id === GAUNTLET_PART.EYE);
  let proxies = proxiesByBossId.get(boss.id);
  if (!proxies) {
    proxies = new Map();
    proxiesByBossId.set(boss.id, proxies);
  }
  const wanted = new Set(boxes.map((box) => box.id));
  for (const [part, proxy] of proxies) {
    if (!wanted.has(part) || !isEntityUsable(proxy)) {
      removeProxy(proxy);
      proxies.delete(part);
    }
  }
  for (const box of boxes) {
    const facing = attempt(() => boss.getViewDirection(), "read Gauntlet eye proxy facing") ?? { x: 0, y: 0, z: 1 };
    const facingLength = Math.max(0.001, Math.hypot(facing.x, facing.y, facing.z));
    // Place the selectable proxy clearly in front of the visible eye so the
    // boss's broad physical collision cannot win the same projectile contact.
    const forwardOffset = 0.28;
    const proxyLocation = {
      x: box.center.x + facing.x / facingLength * forwardOffset,
      y: box.center.y - box.half.y + facing.y / facingLength * forwardOffset,
      z: box.center.z + facing.z / facingLength * forwardOffset
    };
    let proxy = proxies.get(box.id);
    if (!isEntityUsable(proxy)) {
      proxy = spawnProxy(boss, box.id, proxyLocation);
      if (!proxy) continue;
      proxies.set(box.id, proxy);
    }
    attempt(
      () => proxy.teleport(proxyLocation),
      `move Gauntlet ${box.id} proxy`
    );
  }
}

export function proxyParentId(proxy) {
  const value = proxy.getDynamicProperty(PARENT_PROPERTY);
  return typeof value === "string" ? value : undefined;
}

export function proxyPart(proxy) {
  const value = proxy.getDynamicProperty(PART_PROPERTY);
  return typeof value === "string" ? value : undefined;
}

export function cleanupInvalidGauntletProxies(validBossIds) {
  for (const bossId of proxiesByBossId.keys()) {
    if (!validBossIds.has(bossId)) removeGauntletProxies(bossId);
  }
}
