// The column chart's geometry (no React), so it's unit-tested (chart.test.ts). Real pixels, not a scaled viewBox: the
// 2 px gaps and 4 px rounded ends stay exact at any width.

/** The top of a bar chart's axis: a round number (1, 2, 5 × 10ⁿ) at or above the biggest value; at least 1. */
export function niceCeiling(max: number): number {
  if (!(max > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) {
    if (step * power >= max) return step * power;
  }
  return 10 * power;
}

/** Where `count` columns sit across `width` px: each one's slot (its hit target) and the bar inside it, at most 24 px
 * wide with at least 2 px of air between neighbours. */
export function columnLayout(width: number, count: number): { slot: number; bar: number; x: (i: number) => number } {
  const slot = width / Math.max(count, 1);
  const bar = Math.max(1, Math.min(24, slot - 2));
  return { slot, bar, x: (i) => i * slot + (slot - bar) / 2 };
}

/** A column's height in px: none for zero, never thinner than 2 px otherwise, so a small day still shows. */
export function columnHeight(value: number, ceiling: number, plot: number): number {
  return value > 0 ? Math.max(2, (value / ceiling) * plot) : 0;
}

/** A column standing on the baseline (`plot` px down): its top end rounded (4 px), square at the bottom. */
export function barPath(x: number, w: number, h: number, plot: number): string {
  const r = Math.min(4, w / 2, h);
  const top = plot - h;
  return `M${x},${plot}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${plot}Z`;
}

/** The column that carries its number: the biggest (the latest, on a tie); -1 when all are zero. */
export function peakIndex(values: number[]): number {
  let peak = -1;
  values.forEach((v, i) => {
    if (v > 0 && v >= (values[peak] ?? 0)) peak = i;
  });
  return peak;
}

/** When column `i` of `count` starts growing in (ms): one after another, the whole row within about a third of a
 * second however many there are. */
export function growDelay(i: number, count: number): number {
  return Math.round(i * Math.min(40, 360 / Math.max(count, 1)));
}
