export type JsonObject = Record<string, unknown>;

/** Un campo vuoto vale `{}`. Lancia un errore se il testo non è un oggetto JSON. */
export function parseJsonObject(text: string): JsonObject {
  if (!text.trim()) return {};
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('serve un oggetto, per esempio {"V_th": -55}');
  }
  return parsed as JsonObject;
}
