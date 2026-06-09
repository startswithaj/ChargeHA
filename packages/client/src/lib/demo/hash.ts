/**
 * Stateless integer hash → [0, 1). Deterministic and fast — used for
 * reproducible per-day weather variation (demoSimulate) and per-tick sensor
 * jitter (demoTick) without Math.random.
 */
export const hash01 = (n: number): number => {
  const a = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  const b = Math.imul(a ^ (a >>> 13), 0xc2b2ae35);
  return ((b ^ (b >>> 16)) >>> 0) / 4294967296;
};
