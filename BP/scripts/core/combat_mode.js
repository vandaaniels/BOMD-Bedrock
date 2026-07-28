// @ts-check

/**
 * Internal combat profiles. Public Beta 1.5.4 uses java_exact as the
 * reference implementation. bedrock_balanced is intentionally retained as
 * an internal fallback for future optional configuration, but it is not the
 * active profile in this release.
 */
export const COMBAT_MODE = Object.freeze({
  JAVA_EXACT: "java_exact",
  BEDROCK_BALANCED: "bedrock_balanced"
});

export const ACTIVE_COMBAT_MODE = COMBAT_MODE.JAVA_EXACT;

export function isJavaExactMode() {
  return ACTIVE_COMBAT_MODE === COMBAT_MODE.JAVA_EXACT;
}
