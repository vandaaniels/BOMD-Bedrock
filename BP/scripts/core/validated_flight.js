// @ts-check

import { attempt } from "./safe.js";
import { add, distance, length, normalize, scale, subtract } from "./vector.js";

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function randomUnitVector() {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const horizontal = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: horizontal * Math.cos(angle), y: z, z: horizontal * Math.sin(angle) };
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

function rotateAroundAxis(vector, axisInput, degrees) {
  const axis = normalize(axisInput);
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const axisDot = dot(axis, vector);
  const tangent = cross(axis, vector);
  return {
    x: vector.x * cosine + tangent.x * sine + axis.x * axisDot * (1 - cosine),
    y: vector.y * cosine + tangent.y * sine + axis.y * axisDot * (1 - cosine),
    z: vector.z * cosine + tangent.z * sine + axis.z * axisDot * (1 - cosine)
  };
}

function rotateYaw(vector, degrees) {
  return rotateAroundAxis(vector, { x: 0, y: 1, z: 0 }, degrees);
}

function movingTowards(target, position, direction) {
  return distance(add(position, direction), target) < distance(position, target);
}

function withinRangeAfterReaction(position, direction, reactionDistance, target, range) {
  return distance(add(position, scale(direction, reactionDistance)), target) < range;
}

function sampleBoxIsClear(entity, displacement, bounds) {
  const travel = length(displacement);
  if (travel < 0.001) return true;
  const direction = normalize(displacement);
  const horizontal = Math.max(0.15, bounds.width * 0.5 - 0.12);
  const verticalInset = Math.min(0.28, Math.max(0.12, bounds.height * 0.08));
  const middleY = entity.location.y + bounds.height * 0.5;
  const origins = [
    { x: entity.location.x, y: middleY, z: entity.location.z },
    { x: entity.location.x + horizontal, y: middleY, z: entity.location.z },
    { x: entity.location.x - horizontal, y: middleY, z: entity.location.z },
    { x: entity.location.x, y: entity.location.y + verticalInset, z: entity.location.z + horizontal },
    { x: entity.location.x, y: entity.location.y + verticalInset, z: entity.location.z - horizontal },
    { x: entity.location.x, y: entity.location.y + bounds.height - verticalInset, z: entity.location.z + horizontal },
    { x: entity.location.x, y: entity.location.y + bounds.height - verticalInset, z: entity.location.z - horizontal }
  ];
  for (const origin of origins) {
    const hit = attempt(
      () => entity.dimension.getBlockFromRay(origin, direction, {
        maxDistance: travel,
        includeLiquidBlocks: true,
        includePassableBlocks: false
      }),
      "validated flight collision ray"
    );
    if (hit?.block) return false;
  }
  return true;
}

function canMoveThrough(entity, direction, reactionDistance, bounds) {
  const velocity = attempt(() => entity.getVelocity(), "read validated flight velocity") ?? {
    x: 0,
    y: 0,
    z: 0
  };
  const reactionDisplacement = add(scale(direction, reactionDistance), scale(velocity, 0.45));
  return sampleBoxIsClear(entity, reactionDisplacement, bounds);
}

function directionIsValid(entity, target, direction, options) {
  if (!canMoveThrough(entity, direction, options.reactionDistance, options.bounds)) return false;
  const tooClose = withinRangeAfterReaction(
    entity.location,
    direction,
    options.reactionDistance,
    target,
    options.minRange
  );
  const tooFar = !withinRangeAfterReaction(
    entity.location,
    direction,
    options.reactionDistance,
    target,
    options.maxRange
  );
  const approaching = movingTowards(target, entity.location, direction);
  return (tooClose && !approaching) || (tooFar && approaching) || (!tooClose && !tooFar);
}

function weightedDirection(parts) {
  let result = { x: 0, y: 0, z: 0 };
  for (const [direction, weight] of parts) {
    result = add(result, scale(direction, weight));
  }
  return normalize(result);
}

/**
 * Java's selector deliberately wanders inside a broad range. A literal port
 * can become effectively motionless in Bedrock because custom entities use a
 * different drag/collision solver. This intent preserves the same range while
 * giving the selector a radial objective and a stable orbit direction.
 */
function desiredIntent(entity, target, movementState, options) {
  const delta = subtract(target, entity.location);
  const targetDistance = Math.max(0.001, length(delta));
  const toTarget = normalize({
    x: delta.x,
    y: delta.y * (options.verticalWeight ?? 0.65),
    z: delta.z
  });

  if (targetDistance > options.maxRange) return toTarget;
  if (targetDistance < options.minRange) return scale(toTarget, -1);

  const midpoint = (options.minRange + options.maxRange) * 0.5;
  const halfBand = Math.max(1, (options.maxRange - options.minRange) * 0.5);
  const radialError = clamp((targetDistance - midpoint) / halfBand, -1, 1);
  let tangent = normalize(cross({ x: 0, y: movementState.orbitSign ?? 1, z: 0 }, toTarget));
  if (Math.abs(tangent.y) > 0.6 || Math.hypot(tangent.x, tangent.z) < 0.1) {
    tangent = normalize({ x: -toTarget.z * (movementState.orbitSign ?? 1), y: 0, z: toTarget.x * (movementState.orbitSign ?? 1) });
  }
  const verticalCorrection = clamp(delta.y * 0.16, -0.45, 0.45);
  return weightedDirection([
    [tangent, 0.72],
    [toTarget, radialError * 0.78],
    [{ x: 0, y: verticalCorrection, z: 0 }, 1]
  ]);
}

function candidateScore(entity, target, candidate, intent, previous, options) {
  const projected = add(entity.location, scale(candidate, options.reactionDistance));
  const projectedDistance = distance(projected, target);
  const idealDistance = clamp(projectedDistance, options.minRange, options.maxRange);
  const rangePenalty = Math.abs(projectedDistance - idealDistance);
  return dot(candidate, intent) * 4.5 + dot(candidate, previous) * 0.8 - rangePenalty * 0.35;
}

function chooseDirection(entity, target, movementState, options) {
  const previous = normalize(movementState.direction ?? randomUnitVector());
  const intent = desiredIntent(entity, target, movementState, options);
  const candidates = [];
  const addCandidate = (candidate) => {
    const normalized = normalize(candidate);
    if (!candidates.some((existing) => dot(existing, normalized) > 0.998)) candidates.push(normalized);
  };

  addCandidate(intent);
  addCandidate(weightedDirection([[intent, 0.82], [previous, 0.18]]));
  for (const angle of [18, -18, 36, -36, 58, -58, 90, -90, 135, -135]) {
    addCandidate(rotateYaw(intent, angle));
  }
  for (const vertical of [0.22, -0.22, 0.42, -0.42, 0.65, -0.65]) {
    addCandidate({ x: intent.x, y: intent.y + vertical, z: intent.z });
  }
  addCandidate(previous);

  // Retain the upstream randomized fallback after deterministic candidates.
  for (let maximumAngle = 5; maximumAngle < 200; maximumAngle += 20) {
    addCandidate(rotateAroundAxis(previous, randomUnitVector(), Math.random() * maximumAngle));
  }

  let best;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (!directionIsValid(entity, target, candidate, options)) continue;
    const score = candidateScore(entity, target, candidate, intent, previous, options);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  if (best) {
    movementState.direction = best;
    movementState.blockedTicks = 0;
    return best;
  }

  movementState.blockedTicks = (movementState.blockedTicks ?? 0) + 1;
  const verticalEscapes = movementState.blockedTicks % 2 === 0
    ? [{ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }]
    : [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }];
  for (const escape of verticalEscapes) {
    if (canMoveThrough(entity, escape, Math.max(1.5, options.reactionDistance * 0.65), options.bounds)) {
      movementState.direction = escape;
      return escape;
    }
  }

  const reversed = scale(previous, -1);
  movementState.direction = reversed;
  return reversed;
}

function limitMagnitude(vector, maximum) {
  const magnitude = length(vector);
  return magnitude > maximum && magnitude > 0 ? scale(vector, maximum / magnitude) : vector;
}

/**
 * Bedrock-adapted port of ValidatedTargetSelector + VelocitySteering. Range,
 * reaction distance and directional validation remain upstream-compatible;
 * the response coefficient compensates for Bedrock custom-entity drag.
 */
export function tickValidatedFlight(entity, target, movementState, options) {
  const direction = chooseDirection(entity, target, movementState, options);
  const currentVelocity = attempt(() => entity.getVelocity(), "read flight steering velocity") ?? {
    x: 0,
    y: 0,
    z: 0
  };
  const speedScale = options.speedScale ?? 0.23;
  const desiredSpeed = Math.max(0.05, options.flyingSpeed * speedScale);
  const desiredVelocity = scale(direction, desiredSpeed);
  const upstreamResponse = 1 / Math.max(1, options.mass ?? 120);
  const response = Math.max(upstreamResponse, options.response ?? 0.12);
  const maximumImpulse = options.maximumImpulse ?? 0.24;
  const acceleration = limitMagnitude(
    scale(subtract(desiredVelocity, currentVelocity), response),
    maximumImpulse
  );
  attempt(() => entity.applyImpulse(acceleration), "apply validated flight acceleration");

  const previousLocation = movementState.previousLocation;
  const moved = previousLocation ? distance(entity.location, previousLocation) : 1;
  const targetDistance = distance(entity.location, target);
  const outsideRange = targetDistance < options.minRange - 1 || targetDistance > options.maxRange + 1;
  if (outsideRange && moved < 0.012) {
    movementState.stagnantTicks = (movementState.stagnantTicks ?? 0) + 1;
  } else {
    movementState.stagnantTicks = Math.max(0, (movementState.stagnantTicks ?? 0) - 1);
  }
  movementState.previousLocation = { ...entity.location };

  if ((movementState.stagnantTicks ?? 0) === 5) {
    attempt(() => entity.applyImpulse(scale(direction, 0.16)), "unstick validated flight");
  } else if ((movementState.stagnantTicks ?? 0) >= 12) {
    movementState.stagnantTicks = 0;
    movementState.orbitSign = -(movementState.orbitSign ?? 1);
    attempt(() => entity.clearVelocity(), "reset stalled validated flight velocity");
    attempt(() => entity.applyImpulse(scale(direction, 0.32)), "recover stalled validated flight");
  }

  return { direction, acceleration, desiredVelocity, targetDistance };
}


/**
 * Closer port of Java's ValidatedTargetSelector + VelocitySteering. Unlike
 * tickValidatedFlight, this keeps the prior direction, tests randomized
 * rotations in the original 5..185 degree sequence and accepts the first
 * valid candidate instead of scoring toward a stable orbit.
 */
function chooseUpstreamDirection(entity, target, movementState, options) {
  const previous = normalize(movementState.direction ?? randomUnitVector());
  for (let maximumAngle = 5; maximumAngle < 200; maximumAngle += 20) {
    const candidate = normalize(
      rotateAroundAxis(
        previous,
        randomUnitVector(),
        Math.random() * maximumAngle
      )
    );
    if (!directionIsValid(entity, target, candidate, options)) continue;
    movementState.direction = candidate;
    movementState.blockedTicks = 0;
    return candidate;
  }

  movementState.blockedTicks = (movementState.blockedTicks ?? 0) + 1;
  const reversed = scale(previous, -1);
  movementState.direction = reversed;
  return reversed;
}

/**
 * Engine-adapted form of the upstream selector. The selector itself is
 * literal; only speedScale/response/maximumImpulse compensate for Bedrock's
 * custom-entity drag and impulse units.
 */
export function tickUpstreamFlight(entity, target, movementState, options) {
  const direction = chooseUpstreamDirection(
    entity,
    target,
    movementState,
    options
  );
  const currentVelocity =
    attempt(() => entity.getVelocity(), "read upstream flight velocity") ?? {
      x: 0,
      y: 0,
      z: 0
    };
  const desiredSpeed = Math.max(
    0.05,
    options.flyingSpeed * (options.speedScale ?? 0.17)
  );
  const desiredVelocity = scale(direction, desiredSpeed);
  const response = Math.max(
    1 / Math.max(1, options.mass ?? 120),
    options.response ?? 0.055
  );
  const acceleration = limitMagnitude(
    scale(subtract(desiredVelocity, currentVelocity), response),
    options.maximumImpulse ?? 0.11
  );
  attempt(
    () => entity.applyImpulse(acceleration),
    "apply upstream flight acceleration"
  );

  const previousLocation = movementState.previousLocation;
  const moved = previousLocation
    ? distance(entity.location, previousLocation)
    : 1;
  const targetDistance = distance(entity.location, target);
  const outsideRange =
    targetDistance < options.minRange - 1 ||
    targetDistance > options.maxRange + 1;
  if (outsideRange && moved < 0.012) {
    movementState.stagnantTicks =
      (movementState.stagnantTicks ?? 0) + 1;
  } else {
    movementState.stagnantTicks = Math.max(
      0,
      (movementState.stagnantTicks ?? 0) - 1
    );
  }
  movementState.previousLocation = { ...entity.location };

  // Bedrock-only safety net. It is intentionally delayed and weaker than the
  // generic controller so it does not replace the upstream steering pattern.
  if ((movementState.stagnantTicks ?? 0) === 12) {
    attempt(
      () => entity.applyImpulse(scale(direction, 0.08)),
      "unstick upstream flight"
    );
  } else if ((movementState.stagnantTicks ?? 0) >= 30) {
    movementState.stagnantTicks = 0;
    attempt(
      () => entity.applyImpulse(scale(direction, 0.18)),
      "recover upstream flight"
    );
  }

  return { direction, acceleration, desiredVelocity, targetDistance };
}

export function createMovementState(initialDirection) {
  return {
    direction: normalize(initialDirection ?? randomUnitVector()),
    previousLocation: undefined,
    stagnantTicks: 0,
    blockedTicks: 0,
    orbitSign: Math.random() < 0.5 ? -1 : 1
  };
}
