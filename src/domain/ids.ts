export function newId(): string {
  return crypto.randomUUID();
}

export const cellKey = (x: number, y: number) => `${x},${y}`;

/** A, B, ..., Z, AA, AB, ... */
export function codeFromIndex(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** First code in the A, B, C... sequence that is not already taken. */
export function nextBlockCode(taken: string[]): string {
  const set = new Set(taken.map((c) => c.toUpperCase()));
  for (let i = 0; ; i++) {
    const code = codeFromIndex(i);
    if (!set.has(code)) return code;
  }
}
