// @ts-check

import {
  EntityDamageCause
} from "@minecraft/server";
import { isBossCombatPlayer } from "../../core/combat_target.js";
import { attempt, isEntityUsable } from "../../core/safe.js";
import { pointSegmentDistance } from "../../core/oriented_box.js";
import {
  distance,
  horizontalDistance,
  length,
  normalize,
  scale,
  subtract
} from "../../core/vector.js";

const armorStateByBossId = new Map();

export function setGauntletAnimation(boss, value) {
  if (!isEntityUsable(boss)) {
    return;
  }
  attempt(
    () => boss.setProperty("bomd:gauntlet_animation_state", value),
    "set Nether Gauntlet animation"
  );
}

export function setGauntletEnergy(boss, value) {
  if (!isEntityUsable(boss)) {
    return;
  }
  attempt(
    () => boss.setProperty("bomd:gauntlet_energy", value),
    "set Nether Gauntlet energy"
  );
}

export function setGauntletEyeOpen(boss, open) {
  if (!isEntityUsable(boss)) {
    return;
  }
  attempt(
    () => boss.setProperty("bomd:gauntlet_eye_open", open),
    "set Nether Gauntlet eye state"
  );
}

export function setGauntletHandClosed(boss, closed) {
  if (!isEntityUsable(boss)) {
    return;
  }
  const current = attempt(
    () => boss.getProperty("bomd:gauntlet_hand_closed"),
    "read Nether Gauntlet hand state"
  );
  if (current === closed) {
    return;
  }
  attempt(
    () => boss.setProperty("bomd:gauntlet_hand_closed", closed),
    "set Nether Gauntlet hand state"
  );
  attempt(
    () => boss.triggerEvent(closed ? "bomd:close_fist" : "bomd:open_hand"),
    "switch Nether Gauntlet collision volume"
  );
}

export function setGauntletCombatArmor(boss, active) {
  if (!isEntityUsable(boss)) {
    return;
  }
  if (armorStateByBossId.get(boss.id) === active) {
    return;
  }
  armorStateByBossId.set(boss.id, active);
}

export function gauntletArmorValue(boss) {
  return armorStateByBossId.get(boss.id) === true ? 8 : 24;
}

export function convergeGauntletVelocity(
  boss,
  desiredVelocity,
  response = 0.55
) {
  if (!isEntityUsable(boss)) {
    return;
  }
  const velocity =
    attempt(
      () => boss.getVelocity(),
      "read Nether Gauntlet velocity"
    ) ?? { x: 0, y: 0, z: 0 };
  attempt(
    () =>
      boss.applyImpulse({
        x: (desiredVelocity.x - velocity.x) * response,
        y: (desiredVelocity.y - velocity.y) * response,
        z: (desiredVelocity.z - velocity.z) * response
      }),
    "converge Nether Gauntlet velocity"
  );
}

export function applyJavaGauntletSteering(
  boss,
  direction,
  maximumVelocity = 4,
  mass = 120,
  travelDrag = 0.85
) {
  if (!isEntityUsable(boss)) {
    return;
  }
  const velocity = attempt(
    () => boss.getVelocity(),
    "read Java-style Nether Gauntlet velocity"
  ) ?? { x: 0, y: 0, z: 0 };
  const desired = scale(normalize(direction), maximumVelocity);
  // Java VelocitySteering returns (desiredVelocity - currentVelocity) / mass,
  // then GauntletEntity applies 0.85 flying drag in travel(). Reproduce that
  // order rather than turning the idle steering into an artificial dash.
  const inverseMass = 1 / Math.max(1, mass);
  const accelerated = {
    x: velocity.x + (desired.x - velocity.x) * inverseMass,
    y: velocity.y + (desired.y - velocity.y) * inverseMass,
    z: velocity.z + (desired.z - velocity.z) * inverseMass
  };
  const next = scale(accelerated, Math.max(0, Math.min(1, travelDrag)));
  attempt(
    () => boss.applyImpulse({
      x: next.x - velocity.x,
      y: next.y - velocity.y,
      z: next.z - velocity.z
    }),
    "apply Java-style Nether Gauntlet steering"
  );
}

export function canGauntletMoveThrough(
  boss,
  direction,
  reactionDistance = 4
) {
  if (!isEntityUsable(boss)) {
    return false;
  }
  const normedDirection = normalize(direction);
  const velocity = attempt(
    () => boss.getVelocity(),
    "read Nether Gauntlet movement-validation velocity"
  ) ?? { x: 0, y: 0, z: 0 };

  // Java CanMoveThrough validates the future collision volume against
  // direction * reactionDistance + the entity's existing velocity. Bedrock
  // has no direct isSpaceEmpty(Box) equivalent in Script API, so sweep a
  // conservative grid of collision rays through the same displacement.
  const displacement = {
    x: normedDirection.x * reactionDistance + velocity.x,
    y: normedDirection.y * reactionDistance + velocity.y,
    z: normedDirection.z * reactionDistance + velocity.z
  };
  const travelDistance = length(displacement);
  if (travelDistance < 0.001) {
    return true;
  }
  const travel = normalize(displacement);
  let right = normalize({ x: travel.z, y: 0, z: -travel.x });
  if (Math.abs(travel.x) + Math.abs(travel.z) < 0.001) {
    right = { x: 1, y: 0, z: 0 };
  }
  const forwardHorizontal = normalize({ x: travel.x, y: 0, z: travel.z });
  const closed = attempt(
    () => boss.getProperty("bomd:gauntlet_hand_closed"),
    "read Nether Gauntlet collision state"
  ) === true;
  const heights = closed
    ? [0.15, 0.9, 1.75]
    : [0.15, 1.25, 2.5, 3.8];

  // Width is 2 blocks in both Java open/closed collision boxes. Sample both
  // side faces and the centre, with a slight forward/back offset so corners
  // cannot clip diagonally through walls.
  for (const side of [-0.92, 0, 0.92]) {
    for (const depth of [-0.35, 0.35]) {
      for (const height of heights) {
        const origin = {
          x: boss.location.x + right.x * side + forwardHorizontal.x * depth,
          y: boss.location.y + height,
          z: boss.location.z + right.z * side + forwardHorizontal.z * depth
        };
        const blocked = attempt(
          () => boss.dimension.getBlockFromRay(origin, travel, {
            maxDistance: travelDistance,
            includeLiquidBlocks: true,
            includePassableBlocks: false
          }),
          "validate swept Nether Gauntlet movement direction"
        );
        if (blocked) {
          return false;
        }
      }
    }
  }
  return true;
}

export function gauntletVerticalVelocity(boss, target, maximum = 0.11) {
  const desiredY = target.location.y + 0.12;
  return Math.max(
    -maximum,
    Math.min(maximum, (desiredY - boss.location.y) * 0.08)
  );
}

export function holdGauntletForAttack(
  boss,
  target,
  horizontalVelocity = { x: 0, z: 0 },
  response = 0.55
) {
  convergeGauntletVelocity(
    boss,
    {
      x: horizontalVelocity.x,
      y: gauntletVerticalVelocity(boss, target),
      z: horizontalVelocity.z
    },
    response
  );
}

export function combatPlayers(dimension, center, radius) {
  return (
    attempt(
      () =>
        dimension.getPlayers({
          location: center,
          maxDistance: radius
        }),
      "query Nether Gauntlet combat players"
    ) ?? []
  ).filter(isBossCombatPlayer);
}

export function horizontalDirection(from, to) {
  return normalize({
    x: to.x - from.x,
    y: 0,
    z: to.z - from.z
  });
}

export function damagePlayer(player, boss, amount, label) {
  if (!isEntityUsable(player) || !isEntityUsable(boss)) {
    return false;
  }
  return (
    attempt(
      () =>
        player.applyDamage(amount, {
          cause: EntityDamageCause.entityAttack,
          damagingEntity: boss
        }),
      label
    ) === true
  );
}

export function knockPlayer(
  player,
  origin,
  horizontalStrength,
  verticalStrength,
  fallbackDirection = { x: 0, y: 0, z: 1 }
) {
  if (!isEntityUsable(player)) {
    return;
  }
  let direction = horizontalDirection(origin, player.location);
  if (horizontalDistance(origin, player.location) < 0.05) {
    direction = normalize({
      x: fallbackDirection.x,
      y: 0,
      z: fallbackDirection.z
    });
  }
  attempt(
    () =>
      player.applyKnockback(
        {
          x: direction.x * horizontalStrength,
          z: direction.z * horizontalStrength
        },
        verticalStrength
      ),
    "apply Nether Gauntlet knockback"
  );
}

export function targetCenter(target) {
  const head = attempt(
    () => target.getHeadLocation(),
    "read Nether Gauntlet target head"
  );
  if (head) {
    return head;
  }
  return {
    x: target.location.x,
    y: target.location.y + 1,
    z: target.location.z
  };
}

export function targetBoundingCenter(target) {
  // Gauntlet combat targets are players. Java's swirl aims at the player's
  // bounding-box center; a standing player is 1.8 blocks tall, so +0.9 is the
  // stable Bedrock equivalent without depending on an unexposed component.
  return {
    x: target.location.x,
    y: target.location.y + 0.9,
    z: target.location.z
  };
}

export function smoothDirection(current, desired, response) {
  const delta = subtract(desired, current);
  return normalize({
    x: current.x + delta.x * response,
    y: current.y + delta.y * response,
    z: current.z + delta.z * response
  });
}

export function targetPointBeyond(
  boss,
  target,
  multiplier = 1.2,
  verticalMode = "center"
) {
  const origin = {
    x: boss.location.x,
    y: boss.location.y + 1.6,
    z: boss.location.z
  };
  // PunchAction in Java drives through the target position, while the swirl
  // uses the target bounding-box center. Bedrock needs the distinction too:
  // aiming every punch at the head made the hand skim over the player.
  const center = verticalMode === "feet"
    ? { x: target.location.x, y: target.location.y, z: target.location.z }
    : targetBoundingCenter(target);
  const delta = subtract(center, origin);
  return {
    x: origin.x + delta.x * multiplier,
    y: origin.y + delta.y * multiplier,
    z: origin.z + delta.z * multiplier
  };
}

export function driveGauntletToward(
  boss,
  point,
  speed,
  maximumSpeed = 2,
  travelDrag = 0.85
) {
  const origin = {
    x: boss.location.x,
    y: boss.location.y + 1.6,
    z: boss.location.z
  };
  if (distance(origin, point) < 3) {
    return false;
  }
  const direction = normalize(subtract(point, origin));
  const velocity = attempt(
    () => boss.getVelocity(),
    "read Nether Gauntlet punch velocity"
  ) ?? { x: 0, y: 0, z: 0 };
  const alongDirection =
    velocity.x * direction.x +
    velocity.y * direction.y +
    velocity.z * direction.z;
  const transverseVelocity = {
    x: velocity.x - direction.x * alongDirection,
    y: velocity.y - direction.y * alongDirection,
    z: velocity.z - direction.z * alongDirection
  };
  const acceleration = {
    x: (direction.x - transverseVelocity.x) * speed,
    y: (direction.y - transverseVelocity.y) * speed,
    z: (direction.z - transverseVelocity.z) * speed
  };
  const acceleratedVelocity = {
    x: velocity.x + acceleration.x,
    y: velocity.y + acceleration.y,
    z: velocity.z + acceleration.z
  };
  // Java applies the 0.85 flying drag after each acceleration tick. The
  // previous Bedrock cap (0.72-0.82) removed most of the charge momentum.
  const draggedVelocity = scale(acceleratedVelocity, travelDrag);
  const acceleratedSpeed = length(draggedVelocity);
  const limitedVelocity = acceleratedSpeed > maximumSpeed
    ? scale(draggedVelocity, maximumSpeed / acceleratedSpeed)
    : draggedVelocity;
  attempt(
    () => boss.applyImpulse({
      x: limitedVelocity.x - velocity.x,
      y: limitedVelocity.y - velocity.y,
      z: limitedVelocity.z - velocity.z
    }),
    "accelerate Nether Gauntlet punch"
  );
  return true;
}

export function gauntletSpeed(boss) {
  const velocity =
    attempt(
      () => boss.getVelocity(),
      "read Nether Gauntlet attack velocity"
    ) ?? { x: 0, y: 0, z: 0 };
  return length(velocity);
}

export function gauntletOverlapsPlayer(boss, player) {
  const bossCenter = {
    x: boss.location.x,
    y: boss.location.y + 1.25,
    z: boss.location.z
  };
  const playerCenter = targetCenter(player);
  return (
    horizontalDistance(bossCenter, playerCenter) <= 2.15 &&
    Math.abs(bossCenter.y - playerCenter.y) <= 2.35
  );
}

export function gauntletSweepsPlayer(previousLocation, boss, player) {
  const previousCenter = {
    x: previousLocation.x,
    y: previousLocation.y + 1.05,
    z: previousLocation.z
  };
  const currentCenter = {
    x: boss.location.x,
    y: boss.location.y + 1.05,
    z: boss.location.z
  };
  return pointSegmentDistance(
    targetCenter(player),
    previousCenter,
    currentCenter
  ) <= 1.8;
}

export function transferGauntletVelocity(
  boss,
  target,
  multiplier = 0.5,
  impactVelocity = undefined
) {
  if (!isEntityUsable(boss) || !isEntityUsable(target)) {
    return;
  }
  const velocity = impactVelocity ?? attempt(
    () => boss.getVelocity(),
    "read Nether Gauntlet impact velocity"
  ) ?? { x: 0, y: 0, z: 0 };
  attempt(
    () => target.applyImpulse({
      x: velocity.x * multiplier,
      y: velocity.y * multiplier,
      z: velocity.z * multiplier
    }),
    "transfer Nether Gauntlet impact velocity"
  );
}

// Bedrock-native dash mode. Native block collision can zero a scripted flying
// entity's velocity before Script API gets a useful impact frame, leaving the
// Gauntlet pinned to walls. During a committed charge we temporarily let the
// script own block collision and restore normal physics as soon as the charge
// ends.
export function setGauntletDashPhysics(boss, active) {
  if (!isEntityUsable(boss)) return;
  attempt(
    () => boss.triggerEvent(active ? "bomd:begin_scripted_dash" : "bomd:end_scripted_dash"),
    active ? "enable scripted Nether Gauntlet dash" : "disable scripted Nether Gauntlet dash"
  );
}

export function setGauntletDesiredVelocity(boss, desiredVelocity, response = 0.5) {
  convergeGauntletVelocity(boss, desiredVelocity, response);
}

export function probeGauntletPath(boss, direction, maxDistance = 3.0) {
  if (!isEntityUsable(boss)) return false;
  const travel = normalize(direction);
  const horizontal = Math.sqrt(travel.x * travel.x + travel.z * travel.z);
  const right = horizontal > 0.001
    ? { x: travel.z / horizontal, y: 0, z: -travel.x / horizontal }
    : { x: 1, y: 0, z: 0 };
  const closed = attempt(
    () => boss.getProperty("bomd:gauntlet_hand_closed"),
    "read Nether Gauntlet collision state for path probe"
  ) === true;
  const heights = closed ? [0.35, 1.05, 1.75] : [0.35, 1.45, 2.75, 3.65];
  for (const side of [-0.72, 0, 0.72]) {
    for (const height of heights) {
      const origin = {
        x: boss.location.x + right.x * side,
        y: boss.location.y + height,
        z: boss.location.z + right.z * side
      };
      const hit = attempt(
        () => boss.dimension.getBlockFromRay(origin, travel, {
          maxDistance,
          includeLiquidBlocks: true,
          includePassableBlocks: false
        }),
        "probe Nether Gauntlet tactical path"
      );
      if (hit) return false;
    }
  }
  return true;
}

export function predictTargetCenter(target, leadTicks = 6, verticalOffset = 0.9, maximumLead = 4.0) {
  const velocity = attempt(
    () => target.getVelocity(),
    "read Nether Gauntlet target velocity for prediction"
  ) ?? { x: 0, y: 0, z: 0 };
  let lead = {
    x: velocity.x * leadTicks,
    y: velocity.y * leadTicks,
    z: velocity.z * leadTicks
  };
  const leadLength = length(lead);
  if (leadLength > maximumLead) {
    lead = scale(lead, maximumLead / leadLength);
  }
  return {
    x: target.location.x + lead.x,
    y: target.location.y + verticalOffset + lead.y,
    z: target.location.z + lead.z
  };
}
