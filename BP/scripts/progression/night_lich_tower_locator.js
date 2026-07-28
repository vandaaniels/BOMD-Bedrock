// @ts-check

import { system, world } from "@minecraft/server";
import {
  ANCHOR_TYPE,
  TOWER_DEFEATED_PROPERTY
} from "../core/config.js";
import { attempt, isEntityUsable } from "../core/safe.js";
import {
  dimensionHeightRange,
  fitVerticalSpan,
  verticalSpanFits
} from "../core/world_bounds.js";
import { distance } from "../core/vector.js";
import {
  findNearestRegisteredStructure,
  registerStructureLocation
} from "./structure_locator.js";

const PLAN_PROPERTY = "bomd:night_lich_locator_v1";
const OVERWORLD_ID = "minecraft:overworld";
const REGION_CHUNKS = 96;
const REGION_BLOCKS = REGION_CHUNKS * 16;
const MAX_PLAN_RECORDS = 192;
const MAX_CANDIDATE_PROBES = 24;
const MIN_GENERATION_DISTANCE = 1200;
const TOWER_MIN_Y_OFFSET = -23;
const TOWER_MAX_Y_OFFSET = 55;
const TICKING_RADIUS = 24;
const ACCEPTED_BIOME_TAGS = new Set(["cold", "frozen"]);
const REJECTED_BIOME_TAGS = new Set(["ocean", "deep_ocean", "river"]);
const INVALID_SURFACE_IDS = new Set([
  "minecraft:water",
  "minecraft:lava",
  "minecraft:kelp",
  "minecraft:seagrass",
  "minecraft:tall_seagrass"
]);

let resolverQueue = Promise.resolve();

function canonicalDimensionId(dimensionOrId) {
  const raw = typeof dimensionOrId === "string" ? dimensionOrId : dimensionOrId.id;
  if (raw === "overworld" || raw === OVERWORLD_ID) return OVERWORLD_ID;
  if (raw === "nether" || raw === "minecraft:nether") return "minecraft:nether";
  if (raw === "the_end" || raw === "minecraft:the_end") return "minecraft:the_end";
  return raw;
}

function waitTicks(ticks) {
  return new Promise((resolve) => system.runTimeout(resolve, Math.max(1, Math.floor(ticks))));
}

function positiveMod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function hashString(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash | 0;
}

function normalizePlanRecord(candidate) {
  if (!candidate || typeof candidate !== "object") return undefined;
  const rx = Number(candidate.rx);
  const rz = Number(candidate.rz);
  const x = Number(candidate.x);
  const z = Number(candidate.z);
  const y = candidate.y === undefined ? undefined : Number(candidate.y);
  const state = String(candidate.s ?? "");
  if (
    ![rx, rz, x, z].every(Number.isFinite) ||
    (y !== undefined && !Number.isFinite(y)) ||
    !["rejected", "generated", "defeated"].includes(state)
  ) {
    return undefined;
  }
  return {
    rx: Math.floor(rx),
    rz: Math.floor(rz),
    x: Math.floor(x),
    z: Math.floor(z),
    y: y === undefined ? undefined : Math.floor(y),
    s: state
  };
}

function readPlan() {
  const raw = attempt(
    () => world.getDynamicProperty(PLAN_PROPERTY),
    "read Night Lich locator plan"
  );
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePlanRecord).filter(Boolean);
  } catch (error) {
    console.warn(`[BOMD] Night Lich locator plan was invalid and has been reset: ${String(error)}`);
    return [];
  }
}

function writePlan(records) {
  const compact = records.slice(-MAX_PLAN_RECORDS);
  return attempt(() => {
    world.setDynamicProperty(PLAN_PROPERTY, JSON.stringify(compact));
    return true;
  }, "write Night Lich locator plan") === true;
}

function recordKey(record) {
  return `${record.rx}:${record.rz}`;
}

function upsertPlanRecord(incoming) {
  const records = readPlan();
  const key = recordKey(incoming);
  const index = records.findIndex((record) => recordKey(record) === key);
  if (index >= 0) records[index] = incoming;
  else records.push(incoming);
  writePlan(records);
}

function towerTarget(dimension, location, source) {
  return {
    dimension,
    location: {
      x: location.x,
      y: location.y,
      z: location.z
    },
    source
  };
}

function nearestLoadedTower(player) {
  const anchors = attempt(
    () => player.dimension.getEntities({ type: ANCHOR_TYPE }),
    "find loaded Night Lich towers for Soul Star"
  ) ?? [];
  return anchors
    .filter(
      (anchor) =>
        isEntityUsable(anchor) &&
        anchor.getDynamicProperty(TOWER_DEFEATED_PROPERTY) !== true
    )
    .sort(
      (left, right) =>
        distance(left.location, player.location) -
        distance(right.location, player.location)
    )[0];
}

function nearestGeneratedPlan(player) {
  const records = readPlan().filter(
    (record) => record.s === "generated" && Number.isFinite(record.y)
  );
  records.sort((left, right) => {
    const leftDistance = Math.hypot(left.x - player.location.x, left.z - player.location.z);
    const rightDistance = Math.hypot(right.x - player.location.x, right.z - player.location.z);
    return leftDistance - rightDistance;
  });
  const record = records[0];
  if (!record || record.y === undefined) return undefined;
  return towerTarget(
    world.getDimension("overworld"),
    { x: record.x + 0.5, y: record.y + 0.5, z: record.z + 0.5 },
    "generated_plan"
  );
}

function knownTowerTarget(player) {
  const loaded = nearestLoadedTower(player);
  if (isEntityUsable(loaded)) {
    return towerTarget(loaded.dimension, loaded.location, "loaded_anchor");
  }

  const registered = findNearestRegisteredStructure(player, "night_lich", {
    sameDimensionOnly: true,
    excludeDefeated: true
  });
  if (registered) {
    return towerTarget(
      world.getDimension("overworld"),
      { x: registered.x + 0.5, y: registered.y + 0.5, z: registered.z + 0.5 },
      "registry"
    );
  }

  return nearestGeneratedPlan(player);
}

function regionCandidate(regionX, regionZ) {
  const seed = String(world.seed ?? "0");
  const baseHash = hashString(`${seed}:bomd:night_lich:${regionX}:${regionZ}`);
  const xHash = hashString(`${baseHash}:x`);
  const zHash = hashString(`${baseHash}:z`);
  const chunkX = regionX * REGION_CHUNKS + positiveMod(xHash, REGION_CHUNKS);
  const chunkZ = regionZ * REGION_CHUNKS + positiveMod(zHash, REGION_CHUNKS);
  return {
    rx: regionX,
    rz: regionZ,
    x: chunkX * 16 + 8,
    z: chunkZ * 16 + 8
  };
}

function candidateRegionsAround(location, ringLimit = 8) {
  const centerRegionX = Math.floor(location.x / REGION_BLOCKS);
  const centerRegionZ = Math.floor(location.z / REGION_BLOCKS);
  const candidates = [];
  for (let ring = 0; ring <= ringLimit; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dz = -ring; dz <= ring; dz += 1) {
        if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        candidates.push(regionCandidate(centerRegionX + dx, centerRegionZ + dz));
      }
    }
  }
  candidates.sort(
    (left, right) =>
      Math.hypot(left.x - location.x, left.z - location.z) -
      Math.hypot(right.x - location.x, right.z - location.z)
  );
  return candidates;
}

function biomeTags(biome) {
  try {
    if (typeof biome?.getTags === "function") {
      return new Set(biome.getTags().map((tag) => String(tag)));
    }
  } catch {
    // The identifier fallback below still filters obvious oceans.
  }
  return new Set();
}

function biomeIsSuitable(biome) {
  const tags = biomeTags(biome);
  const identifier = String(biome?.id ?? "").toLowerCase();
  const accepted = [...ACCEPTED_BIOME_TAGS].some(
    (tag) => tags.has(tag) || identifier.includes(tag)
  );
  const rejected = [...REJECTED_BIOME_TAGS].some(
    (tag) => tags.has(tag) || identifier.includes(tag)
  );
  return accepted && !rejected;
}

function validSurfaceBlock(block) {
  return (
    block !== undefined &&
    block !== null &&
    block.isAir !== true &&
    block.isLiquid !== true &&
    !INVALID_SURFACE_IDS.has(block.typeId)
  );
}

function inspectTowerSite(dimension, candidate) {
  const centerSurface = dimension.getTopmostBlock({ x: candidate.x, z: candidate.z });
  if (!validSurfaceBlock(centerSurface)) return undefined;

  const centerY = centerSurface.location.y + 1;
  const biome = dimension.getBiome({ x: candidate.x, y: centerY, z: candidate.z });
  if (!biomeIsSuitable(biome)) return undefined;

  const sampleOffsets = [
    [0, 0],
    [-12, -12], [-12, 0], [-12, 12],
    [0, -12], [0, 12],
    [12, -12], [12, 0], [12, 12]
  ];
  const heights = [];
  for (const [offsetX, offsetZ] of sampleOffsets) {
    const surface = dimension.getTopmostBlock({
      x: candidate.x + offsetX,
      z: candidate.z + offsetZ
    });
    if (!validSurfaceBlock(surface)) return undefined;
    heights.push(surface.location.y + 1);
  }
  if (Math.max(...heights) - Math.min(...heights) > 4) return undefined;

  const fittedY = fitVerticalSpan(
    dimension,
    Math.round(heights.reduce((sum, value) => sum + value, 0) / heights.length),
    TOWER_MIN_Y_OFFSET,
    TOWER_MAX_Y_OFFSET
  );
  if (
    fittedY === undefined ||
    !verticalSpanFits(dimension, fittedY, TOWER_MIN_Y_OFFSET, TOWER_MAX_Y_OFFSET)
  ) {
    return undefined;
  }
  return {
    x: candidate.x,
    y: fittedY,
    z: candidate.z
  };
}

function nearestUndefeatedAnchor(dimension, location, radius = 128) {
  const x = Number(location?.x);
  const y = Number(location?.y);
  const z = Number(location?.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined;

  return attempt(() => {
    // EntityQueryOptions.location is a full Vector3. Seed candidates used by the
    // remote locator initially contain only X/Z, so passing them directly made
    // the native interface reject an undefined Y coordinate. When Y is known,
    // use the native distance query. Otherwise, inspect loaded anchors and apply
    // a horizontal-radius filter ourselves.
    const anchors = Number.isFinite(y)
      ? dimension.getEntities({
          type: ANCHOR_TYPE,
          location: { x, y, z },
          maxDistance: radius
        })
      : dimension.getEntities({ type: ANCHOR_TYPE });

    const origin = { x, y: Number.isFinite(y) ? y : 0, z };
    return anchors
      .filter((anchor) => {
        if (
          !isEntityUsable(anchor) ||
          anchor.getDynamicProperty(TOWER_DEFEATED_PROPERTY) === true
        ) {
          return false;
        }
        const dx = anchor.location.x - x;
        const dz = anchor.location.z - z;
        return dx * dx + dz * dz <= radius * radius;
      })
      .sort((left, right) => {
        if (Number.isFinite(y)) {
          return distance(left.location, origin) - distance(right.location, origin);
        }
        const leftDistance = Math.hypot(left.location.x - x, left.location.z - z);
        const rightDistance = Math.hypot(right.location.x - x, right.location.z - z);
        return leftDistance - rightDistance;
      })[0];
  }, "inspect generated Night Lich tower anchor");
}

async function withTemporaryTickingArea(dimension, candidate, callback) {
  const manager = world.tickingAreaManager;
  if (!manager || typeof manager.createTickingArea !== "function") {
    throw new Error("TickingAreaManager is unavailable in the active Script API.");
  }
  const range = dimensionHeightRange(dimension);
  const options = {
    dimension,
    from: {
      x: candidate.x - TICKING_RADIUS,
      y: range.min,
      z: candidate.z - TICKING_RADIUS
    },
    to: {
      x: candidate.x + TICKING_RADIUS - 1,
      y: range.max - 1,
      z: candidate.z + TICKING_RADIUS - 1
    }
  };
  if (!manager.hasCapacity(options)) {
    throw new Error("No temporary ticking-area capacity is available.");
  }
  const identifier = `bomd_soul_${positiveMod(hashString(`${candidate.rx}:${candidate.rz}`), 0x7fffffff).toString(36)}`;
  try {
    if (manager.hasTickingArea(identifier)) manager.removeTickingArea(identifier);
    await manager.createTickingArea(identifier, options);
    await waitTicks(12);
    return await callback();
  } finally {
    try {
      if (manager.hasTickingArea(identifier)) manager.removeTickingArea(identifier);
    } catch (error) {
      console.warn(`[BOMD] remove temporary Soul Star ticking area failed: ${String(error)}`);
    }
  }
}

function placeTower(dimension, candidate, site) {
  const nearby = nearestUndefeatedAnchor(dimension, site, 128);
  if (isEntityUsable(nearby)) {
    registerStructureLocation("night_lich", dimension, nearby.location, { defeated: false });
    return towerTarget(dimension, nearby.location, "natural_anchor");
  }

  const origin = {
    x: Math.floor(site.x) - 16,
    y: Math.floor(site.y) + TOWER_MIN_Y_OFFSET,
    z: Math.floor(site.z) - 14
  };
  const result = dimension.runCommand(
    `structure load bomd:night_lich_tower ${origin.x} ${origin.y} ${origin.z}`
  );
  if (!result || result.successCount < 1) {
    throw new Error("The Night Lich tower structure could not be placed.");
  }

  const anchor = dimension.spawnEntity(ANCHOR_TYPE, {
    x: Math.floor(site.x) + 0.5,
    y: Math.floor(site.y) + 0.5,
    z: Math.floor(site.z) + 0.5
  });
  if (!isEntityUsable(anchor)) {
    throw new Error("The Night Lich tower anchor could not be created.");
  }
  anchor.setDynamicProperty(TOWER_DEFEATED_PROPERTY, false);
  registerStructureLocation("night_lich", dimension, anchor.location, { defeated: false });
  upsertPlanRecord({
    rx: candidate.rx,
    rz: candidate.rz,
    x: Math.floor(site.x),
    y: Math.floor(site.y),
    z: Math.floor(site.z),
    s: "generated"
  });
  return towerTarget(dimension, anchor.location, "soul_star_generated");
}

async function resolveBySeed(player) {
  const known = knownTowerTarget(player);
  if (known) return known;

  const dimension = world.getDimension("overworld");
  const plan = readPlan();
  const planByKey = new Map(plan.map((record) => [recordKey(record), record]));
  const candidates = candidateRegionsAround(player.location).filter(
    (candidate) =>
      Math.hypot(
        candidate.x - player.location.x,
        candidate.z - player.location.z
      ) >= MIN_GENERATION_DISTANCE
  );
  let probes = 0;

  for (const candidate of candidates) {
    const existing = planByKey.get(recordKey(candidate));
    if (existing?.s === "rejected" || existing?.s === "defeated") continue;
    if (existing?.s === "generated" && existing.y !== undefined) {
      return towerTarget(
        dimension,
        { x: existing.x + 0.5, y: existing.y + 0.5, z: existing.z + 0.5 },
        "generated_plan"
      );
    }
    if (probes >= MAX_CANDIDATE_PROBES) break;
    probes += 1;

    try {
      const target = await withTemporaryTickingArea(dimension, candidate, async () => {
        const natural = nearestUndefeatedAnchor(dimension, candidate, 128);
        if (isEntityUsable(natural)) {
          registerStructureLocation("night_lich", dimension, natural.location, { defeated: false });
          return towerTarget(dimension, natural.location, "natural_anchor");
        }
        const site = inspectTowerSite(dimension, candidate);
        if (!site) return undefined;
        const nearbyPlayers = dimension.getPlayers({
          location: site,
          maxDistance: 256
        });
        if (nearbyPlayers.length > 0) return { busy: true };
        const placed = placeTower(dimension, candidate, site);
        await waitTicks(16);
        return placed;
      });
      if (target?.busy === true) continue;
      if (target) return target;
      const rejected = {
        rx: candidate.rx,
        rz: candidate.rz,
        x: candidate.x,
        y: undefined,
        z: candidate.z,
        s: "rejected"
      };
      upsertPlanRecord(rejected);
      planByKey.set(recordKey(rejected), rejected);
    } catch (error) {
      console.warn(`[BOMD] Soul Star remote tower probe failed at ${candidate.x}, ${candidate.z}: ${String(error)}`);
      // Capacity and transient loading failures should be retried on the next
      // use rather than permanently rejecting a valid region.
      break;
    }
  }
  return undefined;
}

/**
 * Resolves an undefeated Night Lich tower without requiring prior exploration.
 * The first unresolved use may load a small temporary remote area, validate a
 * deterministic seed-derived site and place the structure there.
 *
 * @param {import("@minecraft/server").Player} player
 */
export function resolveSoulStarTowerTarget(player) {
  if (
    !isEntityUsable(player) ||
    canonicalDimensionId(player.dimension.id) !== OVERWORLD_ID
  ) {
    return Promise.resolve({ status: "wrong_dimension", target: undefined });
  }

  const known = knownTowerTarget(player);
  if (known) return Promise.resolve({ status: "found", target: known });

  const task = async () => {
    const refreshed = knownTowerTarget(player);
    if (refreshed) return { status: "found", target: refreshed };
    const target = await resolveBySeed(player);
    return target
      ? { status: "found", target }
      : { status: "failed", target: undefined };
  };
  const result = resolverQueue.then(task, task);
  resolverQueue = result.then(() => undefined, () => undefined);
  return result;
}

function updatePlanTowerState(dimension, location, state) {
  if (canonicalDimensionId(dimension.id) !== OVERWORLD_ID) return false;
  const records = readPlan();
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.s !== "generated" && record.s !== "defeated") continue;
    const currentDistance = Math.hypot(record.x - location.x, record.z - location.z);
    if (currentDistance <= 128 && currentDistance < bestDistance) {
      bestDistance = currentDistance;
      bestIndex = index;
    }
  }
  if (bestIndex < 0) return false;
  records[bestIndex] = { ...records[bestIndex], s: state };
  return writePlan(records);
}

export function markLocatorTowerDefeated(dimension, location) {
  return updatePlanTowerState(dimension, location, "defeated");
}

export function markLocatorTowerAvailable(dimension, location) {
  return updatePlanTowerState(dimension, location, "generated");
}
