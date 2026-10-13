/** Numero in formato it-IT; `digits` decimali al massimo, `minDigits` al minimo. 'n.d.' se il valore manca. */
export function formatNumber(value: unknown, digits = 0, minDigits = digits): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n.d.';
  return value.toLocaleString('it-IT', { minimumFractionDigits: minDigits, maximumFractionDigits: digits });
}

/** Numero scritto com'è, con i decimali che ha: per i valori citati in note e messaggi ("0,1 ms"). */
export function formatValue(value: unknown): string {
  return formatNumber(value, 6, 0);
}

/** "1 popolazione", "3 popolazioni": il numero in formato it-IT con il nome accordato. */
export function plural(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}
