// @ts-check

/**
 * Creates a client-localized RawMessage. Minecraft resolves the translation
 * token using the language selected by each player.
 *
 * @param {string} key
 * @param {(string|number)[]} [values]
 * @returns {import("@minecraft/server").RawMessage}
 */
export function translate(key, values = []) {
  const message = { translate: key };
  if (values.length > 0) {
    message.with = values.map((value) => String(value));
  }
  return message;
}
