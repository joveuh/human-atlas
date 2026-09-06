const SMALL = new Set(['of', 'and', 'the', 'to', 'with', 'in', 'for', 'at']);

/** "left coracobrachialis" → "Left Coracobrachialis". The reference capitalises every word, including "Of". */
export function titleCase(name: string, keepSmall = false): string {
  return name
    .split(' ')
    .map((w) => {
      if (!w) return w;
      if (keepSmall && SMALL.has(w)) return w;
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(' ');
}

export const fmt = (n: number) => n.toLocaleString('en-US');

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Deterministic 0..1 hash so the explode stagger is stable between sessions. */
export function hash01(i: number): number {
  let x = (i + 1) * 2654435761;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519);
  x ^= x >>> 13;
  x = Math.imul(x, 3266489917);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
