// Time helpers for the films: everything on screen is a pure function of the film's clock.

export const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** 0 before `a`, 1 after `b`, linear between. */
export const prog = (t: number, a: number, b: number): number => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));

export type Ease = (x: number) => number;
export const linear: Ease = (x) => x;
export const inOut: Ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const out3: Ease = (x) => 1 - Math.pow(1 - x, 3);
export const out4: Ease = (x) => 1 - Math.pow(1 - x, 4);
export const out5: Ease = (x) => 1 - Math.pow(1 - x, 5);
export const in3: Ease = (x) => x * x * x;
export const outExpo: Ease = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
export const inOutExpo: Ease = (x) =>
  x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2;
export const inOutSine: Ease = (x) => -(Math.cos(Math.PI * x) - 1) / 2;
/** A soft overshoot, for things that land (cards, numbers). */
export const outBack: Ease = (x) => {
  const c1 = 1.25;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
/** A critically damped spring from 0 to 1 over about `x` = 1 (settles, never rings). */
export const spring: Ease = (x) => (x >= 1 ? 1 : 1 - (1 + 6 * x) * Math.exp(-6 * x));

/** `ease(prog(t, a, b))`. */
export const ep = (t: number, a: number, b: number, ease: Ease = out3): number => ease(prog(t, a, b));

/** Piecewise through [time, value] keys with an ease per segment (the ease of the key it arrives at). */
export function keys(t: number, ks: Array<[number, number, Ease?]>): number {
  if (!ks.length) return 0;
  if (t <= ks[0]![0]) return ks[0]![1];
  for (let i = 1; i < ks.length; i++) {
    const [t1, v1, e = inOut] = ks[i]!;
    const [t0, v0] = ks[i - 1]!;
    if (t <= t1) return lerp(v0, v1, e(prog(t, t0, t1)));
  }
  return ks[ks.length - 1]![1];
}

/** In over [a, a+inDur], out over [b-outDur, b]: 0..1..0. */
export function envelope(t: number, a: number, b: number, inDur = 0.5, outDur = 0.4, ein: Ease = out3, eout: Ease = in3): number {
  if (t < a || t > b) return 0;
  const i = inDur > 0 ? ein(prog(t, a, a + inDur)) : 1;
  const o = outDur > 0 ? 1 - eout(prog(t, b - outDur, b)) : 1;
  return Math.min(i, o);
}

/** A slow drift for a camera: a smooth noise-free sway, deterministic. */
export function sway(t: number, amp = 1, period = 9, phase = 0): number {
  return Math.sin((t / period) * Math.PI * 2 + phase) * amp;
}

/** Seeded random in [0, 1). */
export function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
