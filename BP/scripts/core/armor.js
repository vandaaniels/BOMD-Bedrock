// @ts-check

/**
 * Reproduces Java armor reduction without the `minecraft:armor` component,
 * which is not part of the stable Bedrock 26.33 schema.
 */
export function damageAfterJavaArmor(damage, armor, toughness = 0) {
  const incoming = Math.max(0, Number(damage) || 0);
  const armorPoints = Math.max(0, Number(armor) || 0);
  const toughnessPoints = Math.max(0, Number(toughness) || 0);
  const effectiveArmor = Math.min(
    20,
    Math.max(
      armorPoints / 5,
      armorPoints - incoming / (2 + toughnessPoints / 4)
    )
  );
  return incoming * (1 - effectiveArmor / 25);
}
