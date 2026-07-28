// @ts-check

import { system } from "@minecraft/server";
import { translate } from "./i18n.js";
import { attempt, isEntityUsable } from "./safe.js";
import { isLocationLoaded } from "./world_bounds.js";

const modes = new Set();
let recording = false;
let registered = false;
const lastSampleTick = new Map();
const movementMetrics = new Map();

const VALID_MODES = new Set([
  "gauntlet_hitboxes",
  "movement",
  "laser",
  "lich_projectiles",
  "teleport"
]);

function notify(source, key, substitutions = []) {
  if (isEntityUsable(source) && source.typeId === "minecraft:player") {
    attempt(
      () => source.sendMessage(translate(key, substitutions)),
      "send BOMD debug message"
    );
  }
}

export function debugEnabled(mode) {
  return modes.has("all") || modes.has(mode);
}

export function comparisonRecordingEnabled() {
  return recording;
}

export function debugPoint(dimension, location, particle = "minecraft:basic_flame_particle") {
  if (!isLocationLoaded(dimension, location)) return;
  attempt(() => dimension.spawnParticle(particle, location), "spawn combat debug point");
}

export function debugLine(
  dimension,
  start,
  end,
  particle = "minecraft:basic_flame_particle",
  spacing = 0.45
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const steps = Math.max(1, Math.ceil(length / Math.max(0.1, spacing)));
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    debugPoint(dimension, {
      x: start.x + dx * t,
      y: start.y + dy * t,
      z: start.z + dz * t
    }, particle);
  }
}

function obbCorner(box, sx, sy, sz) {
  const right = box.axes[0];
  const up = box.axes[1];
  const forward = box.axes[2];
  return {
    x:
      box.center.x +
      right.x * box.half.x * sx +
      up.x * box.half.y * sy +
      forward.x * box.half.z * sz,
    y:
      box.center.y +
      right.y * box.half.x * sx +
      up.y * box.half.y * sy +
      forward.y * box.half.z * sz,
    z:
      box.center.z +
      right.z * box.half.x * sx +
      up.z * box.half.y * sy +
      forward.z * box.half.z * sz
  };
}

export function debugObbs(dimension, boxes) {
  if (!debugEnabled("gauntlet_hitboxes")) return;
  const signs = [-1, 1];
  for (const box of boxes) {
    const particle = box.id === "eye"
      ? "minecraft:basic_portal_particle"
      : "minecraft:basic_smoke_particle";
    const corners = new Map();
    for (const sx of signs) {
      for (const sy of signs) {
        for (const sz of signs) {
          corners.set(`${sx}:${sy}:${sz}`, obbCorner(box, sx, sy, sz));
        }
      }
    }
    for (const sx of signs) {
      for (const sy of signs) {
        debugLine(
          dimension,
          corners.get(`${sx}:${sy}:-1`),
          corners.get(`${sx}:${sy}:1`),
          particle,
          0.25
        );
      }
    }
    for (const sx of signs) {
      for (const sz of signs) {
        debugLine(
          dimension,
          corners.get(`${sx}:-1:${sz}`),
          corners.get(`${sx}:1:${sz}`),
          particle,
          0.25
        );
      }
    }
    for (const sy of signs) {
      for (const sz of signs) {
        debugLine(
          dimension,
          corners.get(`-1:${sy}:${sz}`),
          corners.get(`1:${sy}:${sz}`),
          particle,
          0.25
        );
      }
    }
  }
}

export function debugMovement(dimension, origin, direction, scale = 4) {
  if (!debugEnabled("movement")) return;
  debugLine(
    dimension,
    origin,
    {
      x: origin.x + direction.x * scale,
      y: origin.y + direction.y * scale,
      z: origin.z + direction.z * scale
    },
    "minecraft:basic_portal_particle",
    0.35
  );
}

export function recordCombatEvent(kind, data) {
  if (!recording) return;
  console.warn(`[BOMD_COMPARE] ${JSON.stringify({ tick: system.currentTick, kind, ...data })}`);
}

const MOVEMENT_RANGES = Object.freeze({
  nether_gauntlet: Object.freeze({ minimum: 5, maximum: 25 }),
  night_lich: Object.freeze({ minimum: 15, maximum: 30 })
});

function movementMetric(label, bossId) {
  const key = `${label}:${bossId}`;
  let metric = movementMetrics.get(key);
  if (!metric) {
    metric = {
      label,
      bossId,
      samples: 0,
      speedTotal: 0,
      maximumSpeed: 0,
      verticalSpeedTotal: 0,
      maximumVerticalSpeed: 0,
      distanceSamples: 0,
      distanceTotal: 0,
      minimumDistance: Number.POSITIVE_INFINITY,
      maximumDistance: 0,
      inRangeSamples: 0,
      idleSamples: 0,
      directionChangeTotal: 0,
      directionChangeSamples: 0,
      majorDirectionChanges: 0,
      blockedSamples: 0,
      collisionEpisodes: 0,
      wasBlocked: false,
      outsideSinceTick: undefined,
      returnEpisodes: 0,
      returnTicksTotal: 0,
      maximumReturnTicks: 0,
      previousDirection: undefined
    };
    movementMetrics.set(key, metric);
  }
  return metric;
}

function updateMovementMetric(label, boss, velocity, data) {
  const metric = movementMetric(label, boss.id);
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  metric.samples += 1;
  metric.speedTotal += speed;
  metric.maximumSpeed = Math.max(metric.maximumSpeed, speed);
  metric.verticalSpeedTotal += Math.abs(velocity.y);
  metric.maximumVerticalSpeed = Math.max(metric.maximumVerticalSpeed, Math.abs(velocity.y));
  if (speed < 0.03) metric.idleSamples += 1;

  if (speed >= 0.03) {
    const direction = { x: velocity.x / speed, y: velocity.y / speed, z: velocity.z / speed };
    if (metric.previousDirection) {
      const cosine = Math.max(-1, Math.min(1,
        direction.x * metric.previousDirection.x +
        direction.y * metric.previousDirection.y +
        direction.z * metric.previousDirection.z
      ));
      const degrees = Math.acos(cosine) * 180 / Math.PI;
      metric.directionChangeTotal += degrees;
      metric.directionChangeSamples += 1;
      if (degrees >= 20) metric.majorDirectionChanges += 1;
    }
    metric.previousDirection = direction;
  }

  const targetDistance = Number(data.targetDistance);
  const range = MOVEMENT_RANGES[label];
  if (Number.isFinite(targetDistance)) {
    metric.distanceSamples += 1;
    metric.distanceTotal += targetDistance;
    metric.minimumDistance = Math.min(metric.minimumDistance, targetDistance);
    metric.maximumDistance = Math.max(metric.maximumDistance, targetDistance);
    const inRange = !range || (targetDistance >= range.minimum && targetDistance <= range.maximum);
    if (inRange) {
      metric.inRangeSamples += 1;
      if (metric.outsideSinceTick !== undefined) {
        const returnTicks = system.currentTick - metric.outsideSinceTick;
        metric.returnEpisodes += 1;
        metric.returnTicksTotal += returnTicks;
        metric.maximumReturnTicks = Math.max(metric.maximumReturnTicks, returnTicks);
        metric.outsideSinceTick = undefined;
      }
    } else if (metric.outsideSinceTick === undefined) {
      metric.outsideSinceTick = system.currentTick;
    }
  }

  const blocked = Number(data.blockedTicks ?? 0) > 0 || Number(data.stagnantTicks ?? 0) > 0;
  if (blocked) metric.blockedSamples += 1;
  if (blocked && !metric.wasBlocked) metric.collisionEpisodes += 1;
  metric.wasBlocked = blocked;
}

function roundMetric(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : undefined;
}

function emitMovementMetrics() {
  for (const metric of movementMetrics.values()) {
    const summary = {
      label: metric.label,
      bossId: metric.bossId,
      samples: metric.samples,
      averageSpeed: roundMetric(metric.samples ? metric.speedTotal / metric.samples : 0),
      maximumSpeed: roundMetric(metric.maximumSpeed),
      averageTargetDistance: roundMetric(metric.distanceSamples ? metric.distanceTotal / metric.distanceSamples : 0),
      minimumTargetDistance: roundMetric(metric.minimumDistance),
      maximumTargetDistance: roundMetric(metric.maximumDistance),
      inRangePercentage: roundMetric(metric.distanceSamples ? metric.inRangeSamples * 100 / metric.distanceSamples : 0),
      idlePercentage: roundMetric(metric.samples ? metric.idleSamples * 100 / metric.samples : 0),
      averageVerticalSpeed: roundMetric(metric.samples ? metric.verticalSpeedTotal / metric.samples : 0),
      maximumVerticalSpeed: roundMetric(metric.maximumVerticalSpeed),
      averageDirectionChangeDegrees: roundMetric(metric.directionChangeSamples ? metric.directionChangeTotal / metric.directionChangeSamples : 0),
      majorDirectionChanges: metric.majorDirectionChanges,
      collisionEpisodes: metric.collisionEpisodes,
      blockedPercentage: roundMetric(metric.samples ? metric.blockedSamples * 100 / metric.samples : 0),
      averageReturnTicks: roundMetric(metric.returnEpisodes ? metric.returnTicksTotal / metric.returnEpisodes : 0),
      maximumReturnTicks: metric.maximumReturnTicks
    };
    console.warn(`[BOMD_METRICS] ${JSON.stringify(summary)}`);
  }
}

export function recordBossSample(label, boss, data = {}, interval = 5) {
  if (!recording || !isEntityUsable(boss)) return;
  const key = `${label}:${boss.id}`;
  const now = system.currentTick;
  const previous = lastSampleTick.get(key) ?? -Infinity;
  if (now - previous < interval) return;
  lastSampleTick.set(key, now);
  const velocity = attempt(() => boss.getVelocity(), "read comparison velocity") ?? { x: 0, y: 0, z: 0 };
  const health = attempt(() => boss.getComponent("minecraft:health"), "read comparison health");
  updateMovementMetric(label, boss, velocity, data);
  recordCombatEvent("sample", {
    label,
    id: boss.id,
    location: boss.location,
    velocity,
    health: health?.currentValue,
    maximumHealth: health?.effectiveMax,
    ...data
  });
}

function handleCommand(event) {
  const source = event.sourceEntity;
  if (event.id === "bomd:status") {
    notify(source, "bomd.debug.runtime_status", [system.currentTick]);
    return;
  }
  if (event.id !== "bomd:debug") return;
  const command = String(event.message ?? "").trim().toLowerCase();

  if (command === "off") {
    modes.clear();
    notify(source, "bomd.debug.disabled");
    return;
  }
  if (command === "all") {
    modes.clear();
    modes.add("all");
    notify(source, "bomd.debug.enabled", ["all"]);
    return;
  }
  if (command === "record_start") {
    recording = true;
    lastSampleTick.clear();
    movementMetrics.clear();
    recordCombatEvent("record_start", { source: source?.id });
    notify(source, "bomd.debug.recording_started");
    return;
  }
  if (command === "record_stop") {
    recordCombatEvent("record_stop", { source: source?.id });
    emitMovementMetrics();
    recording = false;
    lastSampleTick.clear();
    notify(source, "bomd.debug.recording_stopped");
    return;
  }
  if (command === "status") {
    notify(source, "bomd.debug.status", [
      [...modes].join(", ") || "off",
      recording ? "on" : "off"
    ]);
    return;
  }
  if (VALID_MODES.has(command)) {
    if (modes.has(command)) {
      modes.delete(command);
      notify(source, "bomd.debug.mode_disabled", [command]);
    } else {
      modes.add(command);
      notify(source, "bomd.debug.enabled", [command]);
    }
    return;
  }
  notify(source, "bomd.debug.help");
}

export function registerCombatDebug() {
  if (registered) return;
  system.afterEvents.scriptEventReceive.subscribe((event) => {
    attempt(() => handleCommand(event), "handle BOMD debug script event");
  });
  registered = true;
}
