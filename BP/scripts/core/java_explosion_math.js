// @ts-check

/**
 * Vanilla Java explosion damage before armor/resistance. The supplied power is
 * the explosion strength; its effective radius is power * 2.
 */
export function javaExplosionDamage(power, distanceFromCenter, exposure = 1) {
  const radius = power * 2;
  if (power <= 0 || distanceFromCenter >= radius) return 0;
  const impact = Math.max(0, (1 - distanceFromCenter / radius) * exposure);
  return Math.floor(((impact * impact + impact) / 2) * 7 * radius + 1);
}
