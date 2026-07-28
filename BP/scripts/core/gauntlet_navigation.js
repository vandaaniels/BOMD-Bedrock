// @ts-check

import { attempt } from "./safe.js";
import { add, distance, length, normalize, scale, subtract } from "./vector.js";

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function randomUnitVector() {
  const y = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
  return { x: Math.cos(angle) * horizontal, y, z: Math.sin(angle) * horizontal };
}

function rotateAroundAxis(vector, axisInput, degrees) {
  const axis = normalize(axisInput);
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const parallel = dot(axis, vector);
  const tangent = cross(axis, vector);
  return {
    x: vector.x * cosine + tangent.x * sine + axis.x * parallel * (1 - cosine),
    y: vector.y * cosine + tangent.y * sine + axis.y * parallel * (1 - cosine),
    z: vector.z * cosine + tangent.z * sine + axis.z * parallel * (1 - cosine)
  };
}

function sampleBoxIsClear(entity, displacement, bounds) {
  const travel = length(displacement);
  if (travel < 0.001) return true;
  const direction = normalize(displacement);
  const radius = Math.max(0.35, bounds.width * 0.5 - 0.08);
  const bottom = entity.location.y + 0.2;
  const middle = entity.location.y + bounds.height * 0.5;
  const top = entity.location.y + bounds.height - 0.2;
  const origins = [
    { x: entity.location.x, y: middle, z: entity.location.z },
    { x: entity.location.x + radius, y: middle, z: entity.location.z },
    { x: entity.location.x - radius, y: middle, z: entity.location.z },
    { x: entity.location.x, y: bottom, z: entity.location.z + radius },
    { x: entity.location.x, y: bottom, z: entity.location.z - radius },
    { x: entity.location.x, y: top, z: entity.location.z + radius },
    { x: entity.location.x, y: top, z: entity.location.z - radius }
  ];
  for (const origin of origins) {
    const hit = attempt(
      () => entity.dimension.getBlockFromRay(origin, direction, {
        maxDistance: travel,
        includeLiquidBlocks: true,
        includePassableBlocks: false
      }),
      "Gauntlet navigation collision ray"
    );
    if (hit?.block) return false;
  }
  return true;
}

function movingToward(position, target, direction) {
  return distance(add(position, direction), target) < distance(position, target);
}

function applyVerticalBand(direction, entityY, anchorY, tolerance, strength) {
  if (!Number.isFinite(anchorY)) return normalize(direction);
  const error = anchorY - entityY;
  let y;
  if (Math.abs(error) <= tolerance) {
    // Inside the permitted band, suppress accumulated random vertical drift.
    y = direction.y * 0.12;
  } else {
    y = clamp(error / Math.max(0.01, tolerance), -1, 1) * strength;
  }
  const horizontalMagnitude = Math.hypot(direction.x, direction.z);
  if (horizontalMagnitude < 0.001) {
    return normalize({ x: 0.001, y, z: 0 });
  }
  return normalize({ x: direction.x, y, z: direction.z });
}

function directionValid(entity, target, direction, options) {
  if (!sampleBoxIsClear(entity, scale(direction, options.reactionDistance), options.bounds)) return false;
  const projected = add(entity.location, scale(direction, options.reactionDistance));
  const projectedDistance = distance(projected, target);
  const approaching = movingToward(entity.location, target, direction);
  if (projectedDistance < options.minRange) return !approaching;
  if (projectedDistance > options.maxRange) return approaching;
  return true;
}

export function createGauntletNavigationState() {
  return {
    direction: randomUnitVector(),
    directionUntilTick: 0,
    blockedTicks: 0,
    stagnantTicks: 0,
    lastLocation: undefined,
    lastProgressTick: 0,
    orbitSign: Math.random() < 0.5 ? -1 : 1
  };
}

/**
 * Reproduces GauntletEntity.travel(..., 0.85f). Bedrock no-gravity entities do
 * not shed velocity in the same way, so the Java drag is applied explicitly.
 */
export function applyGauntletTravelDrag(boss, drag = 0.85) {
  const velocity = attempt(() => boss.getVelocity(), "read Gauntlet travel velocity") ?? { x: 0, y: 0, z: 0 };
  const correction = drag - 1;
  attempt(
    () => boss.applyImpulse({
      x: velocity.x * correction,
      y: velocity.y * correction,
      z: velocity.z * correction
    }),
    "apply Java Gauntlet travel drag"
  );
  return velocity;
}

function chooseJavaDirection(entity, target, movementState, options) {
  const previous = applyVerticalBand(
    normalize(movementState.direction ?? randomUnitVector()),
    entity.location.y,
    options.verticalAnchorY,
    options.verticalTolerance,
    options.verticalCorrectionStrength
  );
  for (let maximumAngle = 5; maximumAngle < 200; maximumAngle += 20) {
    const rotated = normalize(
      rotateAroundAxis(previous, randomUnitVector(), Math.random() * maximumAngle)
    );
    const candidate = applyVerticalBand(
      rotated,
      entity.location.y,
      options.verticalAnchorY,
      options.verticalTolerance,
      options.verticalCorrectionStrength
    );
    if (directionValid(entity, target, candidate, options)) {
      movementState.direction = candidate;
      movementState.blockedTicks = 0;
      return candidate;
    }
  }
  movementState.blockedTicks = (movementState.blockedTicks ?? 0) + 1;
  const reversed = applyVerticalBand(
    scale(previous, -1),
    entity.location.y,
    options.verticalAnchorY,
    options.verticalTolerance,
    options.verticalCorrectionStrength
  );
  movementState.direction = reversed;
  return reversed;
}

function applyVelocityTarget(boss, desired, mass, maximumImpulse = 0.09, label = "Gauntlet velocity steering") {
  const velocity = attempt(() => boss.getVelocity(), "read Gauntlet steering velocity") ?? { x: 0, y: 0, z: 0 };
  let impulse = scale(subtract(desired, velocity), 1 / mass);
  const magnitude = length(impulse);
  if (magnitude > maximumImpulse && magnitude > 0) impulse = scale(impulse, maximumImpulse / magnitude);
  attempt(() => boss.applyImpulse(impulse), label);
  return { impulse, velocity };
}

function applyVelocitySteering(boss, direction, maximumVelocity, mass, maximumImpulse = 0.09) {
  const normalizedDirection = normalize(direction);
  const result = applyVelocityTarget(
    boss,
    scale(normalizedDirection, maximumVelocity),
    mass,
    maximumImpulse,
    "apply Gauntlet velocity steering"
  );
  return { direction: normalizedDirection, ...result };
}

/** Literal Java roaming selector + VelocitySteering. */
export function tickGauntletRoaming(boss, target, movementState, now, options = {}) {
  const settings = {
    reactionDistance: options.reactionDistance ?? 4,
    minRange: options.minRange ?? 5,
    maxRange: options.maxRange ?? 25,
    maximumVelocity: options.maximumVelocity ?? 4,
    mass: options.mass ?? 120,
    maximumImpulse: options.maximumImpulse ?? 0.09,
    refreshTicks: options.refreshTicks ?? 8,
    bounds: options.bounds ?? { width: 2, height: 4 },
    verticalAnchorY: options.verticalAnchorY ?? target.y,
    verticalTolerance: options.verticalTolerance ?? 1.15,
    verticalCorrectionStrength: options.verticalCorrectionStrength ?? 0.72
  };
  if (now >= (movementState.directionUntilTick ?? 0) ||
      !directionValid(boss, target, movementState.direction, settings)) {
    chooseJavaDirection(boss, target, movementState, settings);
    movementState.directionUntilTick = now + settings.refreshTicks;
  }
  movementState.direction = applyVerticalBand(
    movementState.direction,
    boss.location.y,
    settings.verticalAnchorY,
    settings.verticalTolerance,
    settings.verticalCorrectionStrength
  );
  const result = applyVelocitySteering(
    boss,
    movementState.direction,
    settings.maximumVelocity,
    settings.mass,
    settings.maximumImpulse
  );
  updateStagnation(boss, movementState, now);
  return result;
}

/**
 * Deterministic preparation movement. The selected attack is already committed;
 * this function only places the boss in a valid launch band and never rerolls.
 */
export function tickGauntletAttackPositioning(boss, target, movementState, now, options = {}) {
  const minRange = options.minRange ?? 7;
  const maxRange = options.maxRange ?? 18;
  const targetPoint = options.targetPoint ?? target;
  const delta = subtract(targetPoint, boss.location);
  const currentDistance = length(delta);
  const inBand = currentDistance >= minRange && currentDistance <= maxRange;
  let desiredDirection;
  if (currentDistance > maxRange) {
    desiredDirection = normalize(delta);
  } else if (currentDistance < minRange) {
    desiredDirection = scale(normalize(delta), -1);
  } else if (options.orbitWhenInBand === true) {
    // A wall may block the direct charge even though the range is correct.
    // Strafe around the target without abandoning or rerolling the committed
    // attack until a clean launch corridor is available.
    const toTarget = normalize(delta);
    const sign = movementState.orbitSign ?? 1;
    desiredDirection = normalize({
      x: -toTarget.z * sign,
      y: clamp(delta.y * 0.22, -0.35, 0.35),
      z: toTarget.x * sign
    });
  } else {
    // The launch corridor is clear and only facing/velocity settling remains.
    // Brake horizontal drift instead of inventing an arbitrary orbit vector;
    // this prevents the pre-attack state from oscillating around the player.
    const launchSpeed = Math.max(0, options.launchForwardSpeed ?? 0);
    const launchDirection = normalize(delta);
    const desiredVelocity = launchSpeed > 0
      ? scale(launchDirection, launchSpeed)
      : {
          x: 0,
          y: clamp(delta.y * 0.18, -0.35, 0.35),
          z: 0
        };
    const result = applyVelocityTarget(
      boss,
      desiredVelocity,
      options.holdMass ?? 18,
      options.maximumImpulse ?? 0.11,
      "hold Gauntlet launch position"
    );
    movementState.direction = normalize(delta);
    movementState.directionUntilTick = now + 2;
    updateStagnation(boss, movementState, now);
    return {
      direction: movementState.direction,
      ...result,
      distance: currentDistance,
      directClear: true,
      holding: inBand
    };
  }

  const bounds = options.bounds ?? { width: 2, height: 4 };
  const directClear = sampleBoxIsClear(
    boss,
    scale(desiredDirection, options.reactionDistance ?? 4),
    bounds
  );
  if (!directClear) {
    // Use the Java selector only as obstacle avoidance. The attack remains
    // committed and is not replaced by another action.
    const roam = tickGauntletRoaming(boss, targetPoint, movementState, now, {
      minRange,
      maxRange,
      maximumVelocity: options.maximumVelocity ?? 4,
      mass: options.avoidanceMass ?? 85,
      maximumImpulse: options.maximumImpulse ?? 0.11,
      refreshTicks: 5,
      bounds
    });
    return { ...roam, distance: currentDistance, directClear: false };
  }

  movementState.direction = desiredDirection;
  movementState.directionUntilTick = now + 2;
  const result = applyVelocitySteering(
    boss,
    desiredDirection,
    options.maximumVelocity ?? 4,
    options.mass ?? 60,
    options.maximumImpulse ?? 0.11
  );
  updateStagnation(boss, movementState, now);
  return { ...result, distance: currentDistance, directClear: true };
}

function updateStagnation(boss, movementState, now) {
  const previous = movementState.lastLocation;
  if (previous) {
    const moved = distance(previous, boss.location);
    if (moved < 0.025) movementState.stagnantTicks = (movementState.stagnantTicks ?? 0) + 1;
    else movementState.stagnantTicks = 0;
  }
  movementState.lastLocation = { ...boss.location };
  if ((movementState.stagnantTicks ?? 0) === 0) movementState.lastProgressTick = now;
}

export function gauntletChargePathClear(boss, targetPoint, bounds = { width: 2, height: 2 }) {
  const origin = { x: boss.location.x, y: boss.location.y + bounds.height * 0.5, z: boss.location.z };
  const displacement = subtract(targetPoint, origin);
  return sampleBoxIsClear(boss, displacement, bounds);
}

export function gauntletFacingErrorDegrees(boss, targetPoint) {
  const view = normalize(attempt(() => boss.getViewDirection(), "read Gauntlet facing") ?? { x: 0, y: 0, z: 1 });
  const origin = { x: boss.location.x, y: boss.location.y + 1.6, z: boss.location.z };
  const desired = normalize(subtract(targetPoint, origin));
  return Math.acos(clamp(dot(view, desired), -1, 1)) * 180 / Math.PI;
}
