// @ts-check

import { system, world } from "@minecraft/server";
import { attempt, isEntityUsable } from "./safe.js";

export const JAVA_EXACT_PROFILE = "java_exact";
export const BEDROCK_BALANCED_PROFILE = "bedrock_balanced";
export const BALANCE_PROFILE_PROPERTY = "bomd:balance_profile";

const VALID_PROFILES = new Set([
  JAVA_EXACT_PROFILE,
  BEDROCK_BALANCED_PROFILE
]);

export function currentBalanceProfile() {
  const stored = attempt(
    () => world.getDynamicProperty(BALANCE_PROFILE_PROPERTY),
    "read BOMD balance profile"
  );
  return typeof stored === "string" && VALID_PROFILES.has(stored)
    ? stored
    : JAVA_EXACT_PROFILE;
}

export function usesBalancedScaling() {
  return currentBalanceProfile() === BEDROCK_BALANCED_PROFILE;
}

export function effectiveEncounterPlayers(playerCount) {
  if (!usesBalancedScaling()) {
    return 1;
  }
  return Math.max(1, Math.min(8, Math.round(playerCount || 1)));
}

export function balanceRevision(baseRevision) {
  return baseRevision * 10 + (usesBalancedScaling() ? 2 : 1);
}

export function profileDamage(javaDamage, balancedDamage = javaDamage) {
  return usesBalancedScaling() ? balancedDamage : javaDamage;
}

function profileLabel(profile) {
  return profile === JAVA_EXACT_PROFILE
    ? "Java exact (original health and power)"
    : "Bedrock balanced (multiplayer scaling and moderated explosions)";
}

function notifySource(source, message) {
  if (!isEntityUsable(source) || source.typeId !== "minecraft:player") {
    return;
  }
  /** @type {import("@minecraft/server").Player} */ (source).sendMessage(
    message
  );
}

export function registerBalanceProfileCommands() {
  system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "bomd:balance") {
      return;
    }
    const requested = event.message.trim().toLowerCase();
    const source = event.sourceEntity;
    if (!VALID_PROFILES.has(requested)) {
      notifySource(
        source,
        "§cInvalid profile. Use java_exact or bedrock_balanced."
      );
      return;
    }
    world.setDynamicProperty(BALANCE_PROFILE_PROPERTY, requested);
    notifySource(source, `§aBOMD: ${profileLabel(requested)}.`);
  });
}
