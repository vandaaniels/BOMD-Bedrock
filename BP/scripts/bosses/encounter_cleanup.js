// @ts-check

import {
  COMET_TYPE,
  MAGIC_MISSILE_TYPE,
  MINION_TAG
} from "../core/config.js";
import { attempt, isEntityUsable } from "../core/safe.js";

function removeEntities(entities, method) {
  for (const entity of entities) {
    if (!isEntityUsable(entity)) {
      continue;
    }
    attempt(
      () => {
        if (method === "kill") {
          entity.kill();
        } else {
          entity.remove();
        }
      },
      `cleanup ${entity.typeId}`
    );
  }
}

export function cleanupEncounterEntities(dimension, center, radius = 80) {
  const query = {
    location: center,
    maxDistance: radius
  };

  removeEntities(
    dimension.getEntities({
      ...query,
      tags: [MINION_TAG]
    }),
    "kill"
  );
  removeEntities(
    dimension.getEntities({
      ...query,
      type: MAGIC_MISSILE_TYPE
    }),
    "remove"
  );
  removeEntities(
    dimension.getEntities({
      ...query,
      type: COMET_TYPE
    }),
    "remove"
  );
}
