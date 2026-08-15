// @ts-check

import {
  firstOrientedBoxHit,
  horizontalFacingBasis,
  makeOrientedBox
} from "./oriented_box.js";

const MILESTONES = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

export const VOID_HITBOX_STATE = Object.freeze({
  idle: 0,
  spike: 1,
  petal: 2,
  spikeWave1: 3,
  spikeWave2: 4,
  spikeWave3: 5,
  spore: 6
});

const ROOT_THORN = true;
const SOFT_FLOWER = false;

function part(id, center, size, {
  pitch = 0,
  thorn = SOFT_FLOWER,
  collider = "flower_4"
} = {}) {
  return { id, center, size, pitch, thorn, collider };
}

function stateParts(state) {
  switch (state) {
    case VOID_HITBOX_STATE.spike:
      return [
        part("rootYaw", { x: 0, y: 2.75, z: 0 }, { x: 1, y: 5.5, z: 1.5 }, {
          thorn: ROOT_THORN,
          collider: "root_55"
        }),
        part("neck", { x: 0, y: 5, z: 1.25 }, { x: 1, y: 1, z: 1 }, {
          thorn: ROOT_THORN,
          collider: "neck_1"
        }),
        part("flower", { x: 0, y: 4.75, z: 2 }, { x: 4, y: 4, z: 1 }, {
          pitch: 20,
          collider: "flower_4"
        })
      ];
    case VOID_HITBOX_STATE.petal:
      return [
        part("rootYaw", { x: 0, y: 4.5, z: 0 }, { x: 1, y: 9, z: 1 }, {
          thorn: ROOT_THORN,
          collider: "root_9"
        }),
        part("flower", { x: 0, y: 9.5, z: 0 }, { x: 4, y: 1, z: 4 }, {
          collider: "flower_flat_4"
        })
      ];
    case VOID_HITBOX_STATE.spikeWave1:
      return [
        part("rootYaw", { x: 0, y: 3.25, z: 0 }, { x: 1, y: 6.5, z: 1 }, {
          thorn: ROOT_THORN,
          collider: "root_65"
        }),
        part("flower", { x: 0, y: 7, z: 0 }, { x: 4, y: 1, z: 4 }, {
          collider: "flower_flat_4"
        })
      ];
    case VOID_HITBOX_STATE.spikeWave2:
      return [
        part("rootYaw", { x: 0, y: 2, z: 0 }, { x: 1, y: 4, z: 1 }, {
          thorn: ROOT_THORN,
          collider: "root_4"
        }),
        part("flower", { x: 0, y: 4.5, z: 0 }, { x: 4, y: 1, z: 4 }, {
          collider: "flower_flat_4"
        })
      ];
    case VOID_HITBOX_STATE.spikeWave3:
      return [
        part("rootYaw", { x: 0, y: 1.875, z: 0 }, { x: 1.5, y: 3.75, z: 1.5 }, {
          thorn: ROOT_THORN,
          collider: "root_375"
        })
      ];
    case VOID_HITBOX_STATE.spore:
      return [
        part("rootYaw", { x: 0, y: 4, z: 0 }, { x: 1, y: 8, z: 1 }, {
          thorn: ROOT_THORN,
          collider: "root_8"
        }),
        part("flower", { x: 0, y: 9.5, z: -1 }, { x: 2, y: 3, z: 3 }, {
          collider: "flower_spore"
        })
      ];
    default:
      return [
        part("rootYaw", { x: 0, y: 2.75, z: 0 }, { x: 1, y: 5.5, z: 1.5 }, {
          thorn: ROOT_THORN,
          collider: "root_55"
        }),
        part("neck", { x: 0, y: 6.5, z: 1.25 }, { x: 1, y: 1, z: 3.5 }, {
          pitch: -15,
          thorn: ROOT_THORN,
          collider: "neck_long"
        }),
        part("flower", { x: 0, y: 6.5, z: 3.5 }, { x: 4, y: 4, z: 1 }, {
          pitch: 10,
          collider: "flower_4"
        }),
        part("flowerBottom", { x: 0, y: 4, z: 3 }, { x: 1, y: 1, z: 0.5 }, {
          pitch: 10,
          collider: "small"
        })
      ];
  }
}

export function voidOrientedParts({
  bossLocation,
  bossForward,
  state = VOID_HITBOX_STATE.idle
}) {
  const basis = horizontalFacingBasis(bossForward);
  const boxes = stateParts(state).map((definition) => makeOrientedBox({
    ...definition,
    origin: bossLocation,
    basis
  }));
  if (state === VOID_HITBOX_STATE.idle) {
    const flowerIndex = boxes.findIndex((box) => box.id === "flower");
    const bottomIndex = boxes.findIndex((box) => box.id === "flowerBottom");
    const flower = boxes[flowerIndex];
    if (flower && bottomIndex >= 0) {
      boxes[bottomIndex] = makeOrientedBox({
        id: "flowerBottom",
        origin: flower.center,
        basis: flower.basis,
        center: { x: 0, y: -2.5, z: -0.5 },
        size: { x: 1, y: 1, z: 0.5 },
        thorn: false,
        collider: "small"
      });
    }
  }
  return boxes;
}

export function firstVoidBlossomPartHit({
  bossLocation,
  bossForward,
  state = VOID_HITBOX_STATE.idle,
  rayOrigin,
  rayDirection,
  maximumDistance,
  inflate = 0
}) {
  return firstOrientedBoxHit(
    voidOrientedParts({ bossLocation, bossForward, state }),
    rayOrigin,
    rayDirection,
    maximumDistance,
    inflate
  );
}

export function clampVoidPlayerCount(value) {
  const number = Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, Math.min(8, number));
}

export function voidHealthStage(healthRatio) {
  const ratio = Math.max(0, Math.min(1, healthRatio));
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  if (ratio > 0) return 1;
  return 0;
}

export function crossedVoidMilestone(previousRatio, currentRatio) {
  return MILESTONES.slice(1, -1).some(
    (milestone) => previousRatio > milestone && currentRatio <= milestone
  );
}

export function nextVoidHealCap(currentHealth, maxHealth) {
  if (maxHealth <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, currentHealth / maxHealth));
  const upper = MILESTONES.find((milestone) => milestone > ratio + 0.000001) ?? 1;
  return Math.max(currentHealth, maxHealth * upper - 1);
}

export function cappedVoidHeal(currentHealth, maxHealth, amount) {
  return Math.min(
    maxHealth,
    nextVoidHealCap(currentHealth, maxHealth),
    currentHealth + Math.max(0, amount)
  );
}

export function protectedBlossomCount(healthRatio) {
  if (healthRatio < 0.25) return 6;
  if (healthRatio < 0.5) return 3;
  return 0;
}

export function voidAttackWeights({ healthRatio, targetDistance }) {
  const near = targetDistance <= 21 ? 1 : 0;
  return {
    spike: 1,
    spikeWave: near,
    spore: healthRatio < 0.75 ? near : 0,
    blade: healthRatio < 0.5 ? 1 : 0
  };
}

export function voidBlossomOffsets(radius = 15) {
  const diagonal = radius / Math.sqrt(2);
  return [
    { x: radius, z: 0 },
    { x: 0, z: radius },
    { x: -radius, z: 0 },
    { x: 0, z: -radius },
    { x: diagonal, z: diagonal },
    { x: diagonal, z: -diagonal },
    { x: -diagonal, z: diagonal },
    { x: -diagonal, z: -diagonal }
  ];
}

export function predictedVoidTarget(location, velocity, ticks = 8) {
  const lead = Math.max(0, Math.min(12, ticks));
  return {
    x: location.x + velocity.x * lead,
    y: location.y,
    z: location.z + velocity.z * lead
  };
}
