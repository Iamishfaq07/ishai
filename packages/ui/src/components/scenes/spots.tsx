import type { ReactNode } from "react";
import { cx } from "../cx";
import { ACCENT, ACCENT_FILL, ACCENT_SOFT, DRAW, NUDGE, POP, SPARK, at, useShown } from "./parts";

/**
 * Spot graphics (DESIGN.md "Scenes", D70): a section's or a card's own small picture, 40 px on a quiet tile (56 for a
 * card that leads with it). The scenes' hand at icon size: ink outlines, paper fills, and one accent stroke that draws
 * itself in the first time the spot is seen (Gentle fades it, Off shows it drawn); it lifts a hair while its card is
 * hovered. At most one per card; they label a section, they don't decorate it. Decorative: the heading says it.
 */
const INK = "stroke-zinc-500/80 dark:stroke-zinc-400/80";
const PAPER = "fill-white stroke-zinc-500/80 dark:fill-zinc-900 dark:stroke-zinc-400/80";
const FAINT = "stroke-zinc-300 dark:stroke-white/20";
const A = `${ACCENT} ${DRAW}`;
const W = 1.6;

/** An accent stroke that draws in. */
const Draw = ({ d, w = 1.8, delay = 200 }: { d: string; w?: number; delay?: number }) => (
  <path d={d} pathLength={1} className={A} strokeWidth={w} style={at(delay)} />
);
/** A page, its title bar and `n` lines. */
const Page = ({ x = 13, y = 9, w = 22, h = 30, n = 3, accent = true }: { x?: number; y?: number; w?: number; h?: number; n?: number; accent?: boolean }) => (
  <>
    <rect x={x} y={y} width={w} height={h} rx="3" className={PAPER} strokeWidth={W} />
    {accent ? <Draw d={`M${x + 4} ${y + 6}h${w * 0.45}`} w={2.2} /> : <path d={`M${x + 4} ${y + 6}h${w * 0.45}`} className={FAINT} strokeWidth="2.2" />}
    {Array.from({ length: n }, (_, i) => (
      <path key={i} d={`M${x + 4} ${y + 12 + i * 5}h${w - 8 - (i % 2) * 4}`} className={FAINT} strokeWidth="1.6" />
    ))}
  </>
);
const Person = ({ x = 24, y = 24, s = 1, accent = false }: { x?: number; y?: number; s?: number; accent?: boolean }) => (
  <>
    <circle cx={x} cy={y - 5 * s} r={4.5 * s} className={accent ? `${ACCENT} fill-white dark:fill-zinc-900` : PAPER} strokeWidth={W} />
    <path d={`M${x - 8 * s} ${y + 9 * s}a${8 * s} ${6.5 * s} 0 0 1 ${16 * s} 0`} className={accent ? ACCENT : INK} strokeWidth={W} />
  </>
);
const Cells = ({ n = 5, x = 9, y = 21, w = 6 }: { n?: number; x?: number; y?: number; w?: number }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      <rect key={i} x={x + i * w} y={y} width={w} height={w} rx="1" className={PAPER} strokeWidth="1.3" />
    ))}
  </>
);
const Bubble = ({ x = 10, y = 12, w = 22, h = 15, accent = false }: { x?: number; y?: number; w?: number; h?: number; accent?: boolean }) => (
  <path
    d={`M${x + 4} ${y}h${w - 8}a4 4 0 0 1 4 4v${h - 8}a4 4 0 0 1-4 4h-${w - 14}l-5 4v-4h-3a4 4 0 0 1-4-4v-${h - 8}a4 4 0 0 1 4-4z`}
    className={accent ? `${ACCENT_SOFT} ${ACCENT}` : PAPER}
    strokeWidth={W}
  />
);
const Shield = () => <path d="M24 9l11 4v9c0 8-5 13-11 16-6-3-11-8-11-16v-9z" className={PAPER} strokeWidth={W} />;
const Bell = () => (
  <>
    <path d="M16 31v-8a8 8 0 0 1 16 0v8l3 3H13z" className={PAPER} strokeWidth={W} />
    <path d="M21 37a3 3 0 0 0 6 0" className={INK} strokeWidth={W} />
  </>
);
const Coin = ({ cx: x = 24, cy: y = 24, r = 9 }: { cx?: number; cy?: number; r?: number }) => <circle cx={x} cy={y} r={r} className={PAPER} strokeWidth={W} />;
const Bars = ({ hi = 2 }: { hi?: number }) => (
  <>
    <path d="M10 37h28" className={INK} strokeWidth={W} />
    {[14, 21, 28, 35].map((x, i) => {
      const h = [9, 15, 12, 19][i]!;
      return i === hi ? <Draw key={x} d={`M${x - 1} 34v-${h}`} w={4.5} delay={150} /> : <path key={x} d={`M${x - 1} 34v-${h}`} className={INK} strokeWidth="4.5" strokeOpacity="0.45" />;
    })}
  </>
);

const SPOTS = {
  // Settings
  appearance: () => (
    <>
      <circle cx="24" cy="24" r="11" className={PAPER} strokeWidth={W} />
      <path d="M24 13a11 11 0 0 1 0 22z" className={`${ACCENT_SOFT} ${POP}`} />
      <Draw d="M24 13a11 11 0 0 1 0 22" />
    </>
  ),
  keyboard: () => (
    <>
      <rect x="9" y="15" width="30" height="18" rx="3" className={PAPER} strokeWidth={W} />
      <path d="M14 21h.1M19 21h.1M24 21h.1M29 21h.1M34 21h.1M16 25h.1M21 25h.1M26 25h.1M31 25h.1" className={INK} strokeWidth="2.4" />
      <Draw d="M17 29h14" w={2} />
    </>
  ),
  voice: () => (
    <>
      <path d="M11 21h5l6-5v16l-6-5h-5z" className={PAPER} strokeWidth={W} />
      <Draw d="M27 19q4 5 0 10" />
      <Draw d="M31 15.5q7 8.5 0 17" delay={350} />
    </>
  ),
  account: () => (
    <>
      <circle cx="24" cy="19" r="4.5" className={`fill-white dark:fill-zinc-900 ${ACCENT} ${POP}`} strokeWidth={W} style={at(100)} />
      <Draw d="M16 33a8 6.5 0 0 1 16 0" delay={250} />
    </>
  ),
  security: () => (
    <>
      <Shield />
      <Draw d="M19 24l4 4 7-8" w={2} />
    </>
  ),
  passkey: () => (
    <>
      <path d="M13 28c1-8 5-13 11-13s10 5 11 13M16.5 32c0-7 3-12 7.5-12s7.5 5 7.5 12" className={INK} strokeWidth={W} />
      <Draw d="M21 36c0-6 1-11 3-11s3 5 3 11" />
    </>
  ),
  devices: () => (
    <>
      <rect x="8" y="12" width="25" height="17" rx="2" className={PAPER} strokeWidth={W} />
      <path d="M16 34h9M20.5 29v5" className={INK} strokeWidth={W} />
      <rect x="29" y="19" width="11" height="17" rx="2.5" className={`fill-white dark:fill-zinc-900 ${ACCENT} ${POP}`} strokeWidth="1.8" style={at(150)} />
    </>
  ),
  privacy: () => (
    <>
      <path d="M18 22v-4a6 6 0 0 1 12 0v4" className={INK} strokeWidth={W} />
      <rect x="13" y="22" width="22" height="16" rx="3" className={PAPER} strokeWidth={W} />
      <Draw d="M24 28v4" w={2.4} />
    </>
  ),
  admin: () => (
    <>
      <path d="M11 16h26M11 24h26M11 32h26" className={INK} strokeWidth={W} />
      <circle cx="17" cy="16" r="2.5" className={PAPER} strokeWidth={W} />
      <circle cx="31" cy="24" r="2.5" className={`${ACCENT_FILL} ${POP}`} style={at(150)} />
      <circle cx="22" cy="32" r="2.5" className={PAPER} strokeWidth={W} />
    </>
  ),
  // Plan & credits
  plan: () => (
    <>
      <rect x="11" y="12" width="26" height="25" rx="3" className={PAPER} strokeWidth={W} />
      <path d="M11 19h26M18 9v6M30 9v6" className={INK} strokeWidth={W} />
      <Draw d="M18.5 27.5l3.5 3.5 7-7" w={2} />
    </>
  ),
  credits: () => (
    <>
      <ellipse cx="24" cy="32" rx="10" ry="3.5" className={PAPER} strokeWidth={W} />
      <ellipse cx="24" cy="26.5" rx="10" ry="3.5" className={PAPER} strokeWidth={W} />
      <ellipse cx="24" cy="21" rx="10" ry="3.5" className={`fill-white dark:fill-zinc-900 ${ACCENT} ${POP}`} strokeWidth="1.8" style={at(150)} />
    </>
  ),
  usage: () => (
    <>
      <path d="M12 31a12 12 0 0 1 24 0" className={INK} strokeWidth={W} />
      <path d="M12 31h24" className={FAINT} strokeWidth={W} />
      <Draw d="M24 31l6-8" w={2} />
      <circle cx="24" cy="31" r="2" className={ACCENT_FILL} />
    </>
  ),
  receipt: () => (
    <>
      <path d="M14 9h20v30l-3.3-2.5-3.4 2.5-3.3-2.5-3.3 2.5-3.4-2.5L14 39z" className={PAPER} strokeWidth={W} />
      <path d="M18 16h9M18 21h12M18 26h7" className={FAINT} strokeWidth="1.6" />
      <Draw d="M24 31h6" w={2.4} />
    </>
  ),
  // Offer AI
  parts: () => (
    <>
      <rect x="9" y="19" width="30" height="10" rx="2" className={PAPER} strokeWidth={W} />
      <rect x="9.8" y="19.8" width="12" height="8.4" rx="1.4" className={`${ACCENT_SOFT} ${POP}`} />
      <path d="M22 19v10M31 19v10" className={INK} strokeWidth={W} />
      <Draw d="M10 34h11" w={2} />
    </>
  ),
  wallet: () => (
    <>
      <rect x="10" y="15" width="28" height="20" rx="3" className={PAPER} strokeWidth={W} />
      <path d="M10 20h20" className={INK} strokeWidth={W} />
      <Draw d="M29 27.5h9" w={2.2} />
      <circle cx="31.5" cy="27.5" r="1.6" className={ACCENT_FILL} />
    </>
  ),
  market: () => <Bars hi={2} />,
  negotiate: () => (
    <>
      <Bubble x={8} y={11} w={20} h={13} />
      <path d="M26 21h10a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4h-2v4l-5-4h-3a4 4 0 0 1-4-4v-6a4 4 0 0 1 4-4z" className={`${ACCENT_SOFT} ${ACCENT} ${POP}`} strokeWidth={W} style={at(150)} />
    </>
  ),
  whatif: () => (
    <>
      <path d="M10 24h28" className={INK} strokeWidth={W} />
      <Draw d="M10 24h17" w={2.4} delay={100} />
      <circle cx="28" cy="24" r="4.5" className={`fill-white dark:fill-zinc-900 ${ACCENT} ${POP}`} strokeWidth="1.8" style={at(300)} />
      <path d="M14 15l-3 3 3 3M34 15l3 3-3 3" className={INK} strokeWidth={W} />
    </>
  ),
  compare: () => (
    <>
      <rect x="9" y="12" width="13" height="24" rx="2.5" className={PAPER} strokeWidth={W} />
      <rect x="26" y="12" width="13" height="24" rx="2.5" className={`fill-white dark:fill-zinc-900 ${ACCENT} ${POP}`} strokeWidth="1.8" style={at(150)} />
      <path d="M12.5 18h6M12.5 23h6M29.5 18h6M29.5 23h6" className={FAINT} strokeWidth="1.6" />
    </>
  ),
  rolepay: () => (
    <>
      <Coin cx={21} cy={21} r={9} />
      <path d="M21 16v10M18.5 18.5h4a2 2 0 0 1 0 4h-3a2 2 0 0 0 0 4h4" className={INK} strokeWidth="1.3" strokeOpacity="0.8" />
      <Draw d="M28 28l8 8" w={2.6} />
    </>
  ),
  // Practice
  screen: () => (
    <>
      <path d="M13 28v-4a11 11 0 0 1 22 0v4" className={INK} strokeWidth={W} />
      <rect x="10" y="26" width="6" height="10" rx="2.5" className={PAPER} strokeWidth={W} />
      <rect x="32" y="26" width="6" height="10" rx="2.5" className={PAPER} strokeWidth={W} />
      <Draw d="M16 34q4 5 9 4" />
    </>
  ),
  intro: () => (
    <>
      <Person x={18} y={27} s={0.9} />
      <g className={POP} style={at(150)}>
        <Bubble x={24} y={8} w={17} h={12} accent />
      </g>
    </>
  ),
  code: () => (
    <>
      <rect x="8" y="11" width="32" height="26" rx="3" className={PAPER} strokeWidth={W} />
      <path d="M19 20l-5 4 5 4M29 20l5 4-5 4" className={INK} strokeWidth={W} />
      <Draw d="M26 18l-4 12" />
    </>
  ),
  panel: () => (
    <>
      <Person x={12} y={26} s={0.65} />
      <Person x={36} y={26} s={0.65} />
      <g className={POP} style={at(150)}>
        <Person x={24} y={24} s={0.85} accent />
      </g>
    </>
  ),
  video: () => (
    <>
      <rect x="8" y="14" width="23" height="20" rx="3" className={PAPER} strokeWidth={W} />
      <path d="M31 21l9-5v16l-9-5" className={INK} strokeWidth={W} />
      <circle cx="14" cy="20" r="2.2" className={`${ACCENT_FILL} ${POP}`} style={at(150)} />
    </>
  ),
  pay: () => (
    <>
      <rect x="8" y="15" width="32" height="18" rx="3" className={PAPER} strokeWidth={W} />
      <circle cx="24" cy="24" r="4.5" className={`${ACCENT_SOFT} ${ACCENT} ${POP}`} strokeWidth="1.8" style={at(150)} />
      <path d="M12.5 19.5h.1M35.5 28.5h.1" className={INK} strokeWidth="2.4" />
    </>
  ),
  // Code AI patterns
  hashing: () => (
    <>
      <path d="M19 12l-3 24M31 12l-3 24M12 19h25M11 29h25" className={INK} strokeWidth={W} />
      <circle cx="23.5" cy="24" r="2.6" className={`${ACCENT_FILL} ${POP}`} style={at(150)} />
    </>
  ),
  pointers: () => (
    <>
      <Cells n={5} x={9} y={24} w={6} />
      <Draw d="M12 16v6M10 20l2 2 2-2" w={1.8} />
      <Draw d="M36 16v6M34 20l2 2 2-2" w={1.8} delay={350} />
    </>
  ),
  window: () => (
    <>
      <Cells n={5} x={9} y={21} w={6} />
      <rect x="13.5" y="18" width="21" height="12" rx="2.5" pathLength={1} className={A} strokeWidth="1.8" style={at(150)} />
    </>
  ),
  binary: () => (
    <>
      <Cells n={6} x={9} y={25} w={5} />
      <Draw d="M24 14v19" w={1.8} />
      <path d="M17 16h-5M31 16h5" className={INK} strokeWidth={W} />
    </>
  ),
  stack: () => (
    <>
      <rect x="13" y="29" width="22" height="7" rx="2" className={PAPER} strokeWidth={W} />
      <rect x="13" y="21" width="22" height="7" rx="2" className={PAPER} strokeWidth={W} />
      <rect x="13" y="12" width="22" height="7" rx="2" className={`${ACCENT_SOFT} ${ACCENT} ${POP}`} strokeWidth="1.8" style={at(150)} />
    </>
  ),
  tree: () => (
    <>
      <path d="M24 16l-8 11M24 16l8 11M16 27l-4 8M16 27l4 8" className={INK} strokeWidth={W} />
      <circle cx="16" cy="27" r="3" className={PAPER} strokeWidth={W} />
      <circle cx="32" cy="27" r="3" className={PAPER} strokeWidth={W} />
      <circle cx="12" cy="36" r="2.4" className={PAPER} strokeWidth={W} />
      <circle cx="20" cy="36" r="2.4" className={PAPER} strokeWidth={W} />
      <circle cx="24" cy="14" r="3.5" className={`${ACCENT_FILL} ${POP}`} style={at(150)} />
    </>
  ),
  intervals: () => (
    <>
      <path d="M10 16h16M18 24h20M10 32h12" className={INK} strokeWidth="3" strokeOpacity="0.45" />
      <Draw d="M18 24h20" w={3} />
    </>
  ),
  dp: () => (
    <>
      {[0, 1, 2].map((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={11 + c * 9} y={11 + r * 9} width="8" height="8" rx="1.5" className={PAPER} strokeWidth="1.3" />))}
      <rect x="29" y="29" width="8" height="8" rx="1.5" className={`${ACCENT_SOFT} ${ACCENT} ${POP}`} strokeWidth="1.6" style={at(300)} />
      <Draw d="M15 15l18 18" w={1.4} delay={100} />
    </>
  ),
  lesson: () => (
    <>
      <path d="M11 35c8 0 6-10 13-10s5-10 13-10" className={FAINT} strokeWidth={W} strokeDasharray="2 3" />
      <Draw d="M11 35c8 0 6-10 13-10" w={1.8} />
      <circle cx="11" cy="35" r="3" className={ACCENT_FILL} />
      <circle cx="24" cy="25" r="3" className={`${ACCENT_FILL} ${POP}`} style={at(400)} />
      <circle cx="37" cy="15" r="3" className={PAPER} strokeWidth={W} />
    </>
  ),
  // Jobs AI
  resume: () => <Page n={4} />,
  target: () => (
    <>
      <circle cx="24" cy="24" r="12" className={PAPER} strokeWidth={W} />
      <circle cx="24" cy="24" r="7" className={INK} strokeWidth={W} />
      <circle cx="24" cy="24" r="2.6" className={`${ACCENT_FILL} ${POP}`} style={at(150)} />
      <Draw d="M24 24l11-11M31 13h4v4" w={1.6} delay={300} />
    </>
  ),
  place: () => (
    <>
      <ellipse cx="24" cy="36" rx="10" ry="3" className={INK} strokeWidth={W} strokeOpacity="0.6" />
      <path d="M24 35c-5-6-8-10-8-14a8 8 0 0 1 16 0c0 4-3 8-8 14z" className={`fill-white dark:fill-zinc-900 ${ACCENT} ${POP}`} strokeWidth="1.8" style={at(150)} />
      <circle cx="24" cy="21" r="2.6" className={ACCENT_FILL} />
    </>
  ),
  briefcase: () => (
    <>
      <path d="M19 16v-3h10v3" className={INK} strokeWidth={W} />
      <rect x="9" y="16" width="30" height="20" rx="3" className={PAPER} strokeWidth={W} />
      <Draw d="M9 25h30" w={1.6} />
      <rect x="21.5" y="23" width="5" height="4" rx="1" className={ACCENT_FILL} />
    </>
  ),
  globe: () => (
    <>
      <circle cx="24" cy="24" r="13" className={PAPER} strokeWidth={W} />
      <path d="M24 11c-4 4-4 22 0 26M24 11c4 4 4 22 0 26M12 19h24M12 29h24" className={INK} strokeWidth="1.2" />
      <Draw d="M8 27c6 4 26 4 32-6" w={1.8} />
    </>
  ),
  alert: () => (
    <>
      <Bell />
      <circle cx="31" cy="15" r="3.5" className={`${ACCENT_FILL} ${POP}`} style={at(150)} />
    </>
  ),
  // Resume AI
  questions: () => (
    <>
      <Bubble x={8} y={10} w={24} h={18} accent />
      <Draw d="M17 16.5a3 3 0 1 1 4 3c-1 .5-1 1-1 2.5M20 25h.1" w={1.8} />
      <path d="M33 22h4a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-1v3l-4-3h-3a3 3 0 0 1-3-3" className={INK} strokeWidth={W} />
    </>
  ),
  gap: () => (
    <>
      <path d="M10 18h28" className={INK} strokeWidth="4" strokeOpacity="0.4" />
      <Draw d="M10 30h15" w={4} />
      <path d="M29 30h9" className={FAINT} strokeWidth="4" strokeDasharray="2 2.5" />
    </>
  ),
  letter: () => (
    <>
      <rect x="9" y="14" width="30" height="21" rx="3" className={PAPER} strokeWidth={W} />
      <Draw d="M10 16l14 10 14-10" />
    </>
  ),
  ats: () => (
    <>
      <Page x={9} y={9} w={20} h={28} n={3} accent={false} />
      <circle cx="31" cy="30" r="8" className={PAPER} strokeWidth={W} />
      <path d="M31 22a8 8 0 1 1-7.6 5.5" pathLength={1} className={A} strokeWidth="2.6" style={at(150)} />
    </>
  ),
  jobpost: () => (
    <>
      <Page n={0} accent={false} />
      <rect x="16" y="19" width="14" height="4" rx="1" className={`${ACCENT_SOFT} ${POP}`} style={at(200)} />
      <path d="M17 21h12M17 27h10M17 32h13" className={FAINT} strokeWidth="1.6" />
      <Draw d="M17 21h12" w={1.6} delay={300} />
    </>
  ),
  rewrite: () => (
    <>
      <Page x={10} y={11} w={21} h={27} n={3} accent={false} />
      <path d={SPARK(33, 14, 5.5)} className={`${ACCENT_FILL} ${POP}`} style={at(200)} />
      <Draw d="M14 33h11" w={1.8} delay={400} />
    </>
  ),
  design: () => (
    <>
      <rect x="12" y="9" width="24" height="30" rx="3" className={PAPER} strokeWidth={W} />
      <rect x="15.5" y="12.5" width="17" height="6" rx="1.5" className={`${ACCENT_SOFT} ${ACCENT} ${POP}`} strokeWidth="1.4" style={at(150)} />
      <path d="M16 23h7M16 27h7M16 31h7M27 23h5M27 27h5" className={FAINT} strokeWidth="1.6" />
    </>
  ),
  colour: () => (
    <>
      <circle cx="19" cy="20" r="7" className={PAPER} strokeWidth={W} />
      <circle cx="29" cy="20" r="7" className={PAPER} strokeWidth={W} />
      <circle cx="24" cy="29" r="7" className={`${ACCENT_SOFT} ${ACCENT} ${POP}`} strokeWidth="1.8" style={at(150)} />
    </>
  ),
  photo: () => (
    <>
      <rect x="11" y="10" width="26" height="28" rx="3" className={PAPER} strokeWidth={W} />
      <circle cx="24" cy="21" r="4.5" className={ACCENT} strokeWidth="1.8" />
      <path d="M16 34a8 6 0 0 1 16 0" pathLength={1} className={A} strokeWidth="1.8" style={at(200)} />
    </>
  ),
  contact: () => (
    <>
      <rect x="8" y="13" width="32" height="22" rx="3" className={PAPER} strokeWidth={W} />
      <circle cx="17" cy="22" r="3.5" className={ACCENT} strokeWidth="1.6" />
      <Draw d="M12 30a5 3.5 0 0 1 10 0" w={1.6} />
      <path d="M26 20h9M26 25h7M26 30h8" className={FAINT} strokeWidth="1.6" />
    </>
  ),
  sections: () => (
    <>
      <rect x="11" y="10" width="26" height="7" rx="2" className={PAPER} strokeWidth={W} />
      <rect x="11" y="20.5" width="26" height="7" rx="2" className={`${ACCENT_SOFT} ${ACCENT} ${POP}`} strokeWidth="1.6" style={at(150)} />
      <rect x="11" y="31" width="26" height="7" rx="2" className={PAPER} strokeWidth={W} />
    </>
  ),
  summary: () => (
    <>
      <Draw d="M11 15h26" w={2.4} />
      <path d="M11 22h26M11 28h22M11 34h16" className={INK} strokeWidth="1.8" strokeOpacity="0.55" />
    </>
  ),
  skills: () => (
    <>
      <rect x="8" y="13" width="15" height="8" rx="4" className={PAPER} strokeWidth={W} />
      <rect x="25" y="13" width="15" height="8" rx="4" className={`${ACCENT_SOFT} ${ACCENT} ${POP}`} strokeWidth="1.6" style={at(150)} />
      <rect x="8" y="25" width="20" height="8" rx="4" className={PAPER} strokeWidth={W} />
      <rect x="30" y="25" width="10" height="8" rx="4" className={PAPER} strokeWidth={W} />
    </>
  ),
  readability: () => (
    <>
      <path d="M8 24q16-14 32 0q-16 14-32 0z" className={PAPER} strokeWidth={W} />
      <circle cx="24" cy="24" r="5" className={`${ACCENT_FILL} ${POP}`} style={at(150)} />
    </>
  ),
  keywords: () => (
    <>
      <path d="M10 14v9l14 14 13-13-14-14h-9a4 4 0 0 0-4 4z" className={PAPER} strokeWidth={W} />
      <circle cx="17" cy="17" r="2.5" className={`${ACCENT_FILL} ${POP}`} style={at(150)} />
      <Draw d="M22 26l6-6" w={1.8} delay={300} />
    </>
  ),
  // Story bank, answers, evidence
  coverage: () => (
    <>
      <circle cx="24" cy="24" r="11" className={INK} strokeWidth="4" strokeOpacity="0.25" />
      <path d="M24 13a11 11 0 1 1-10.5 14.3" pathLength={1} className={A} strokeWidth="4" style={at(150)} />
    </>
  ),
  story: () => (
    <>
      <path d="M24 14c-4-3-9-3-14-2v24c5-1 10-1 14 2zM24 14c4-3 9-3 14-2v24c-5-1-10-1-14 2z" className={PAPER} strokeWidth={W} />
      <path d="M31 11v9l2.5-2 2.5 2V11.5" className={`${ACCENT_SOFT} ${ACCENT} ${POP}`} strokeWidth="1.6" style={at(150)} />
    </>
  ),
  drafts: () => (
    <>
      <Page x={10} y={10} w={21} h={28} n={3} accent={false} />
      <path d="M27 34l9-15 3.5 2-9 15-4.5 2.2z" className={`fill-white dark:fill-zinc-900 ${ACCENT} ${POP}`} strokeWidth="1.6" style={at(200)} />
    </>
  ),
  answer: () => (
    <>
      <Bubble x={9} y={11} w={28} h={19} />
      <Draw d="M18 20l4 4 7-8" w={2} />
    </>
  ),
  review: () => (
    <>
      <path d="M11 13h18M11 19h14M11 25h10" className={FAINT} strokeWidth="1.8" />
      <circle cx="27" cy="26" r="7" className={PAPER} strokeWidth={W} />
      <Draw d="M32 31l6 6" w={2.6} />
    </>
  ),
  evidence: () => (
    <>
      <Shield />
      <path d="M19.5 23c0-2.5 1.5-4 3-4M26 23c0-2.5 1.5-4 3-4" className={ACCENT} strokeWidth="1.8" />
      <circle cx="20.5" cy="24.5" r="1.8" className={`${ACCENT_FILL} ${POP}`} style={at(150)} />
      <circle cx="27" cy="24.5" r="1.8" className={`${ACCENT_FILL} ${POP}`} style={at(250)} />
    </>
  ),
  // Copilot
  context: () => (
    <>
      <rect x="15" y="8" width="21" height="27" rx="3" className={PAPER} strokeWidth={W} />
      <rect x="11" y="13" width="21" height="27" rx="3" className={PAPER} strokeWidth={W} />
      <Draw d="M15 19h9" w={2.2} />
      <path d="M15 25h12M15 30h9" className={FAINT} strokeWidth="1.6" />
    </>
  ),
  audio: () => (
    <>
      {[12, 17, 22, 27, 32, 37].map((x, i) => {
        const h = [6, 12, 20, 14, 9, 5][i]!;
        return i === 2 ? <Draw key={x} d={`M${x - 0.5} ${24 - h / 2}v${h}`} w={2.6} /> : <path key={x} d={`M${x - 0.5} ${24 - h / 2}v${h}`} className={INK} strokeWidth="2.6" />;
      })}
    </>
  ),
  timeline: () => (
    <>
      <path d="M9 24h30" className={INK} strokeWidth={W} />
      <circle cx="12" cy="24" r="3" className={PAPER} strokeWidth={W} />
      <circle cx="24" cy="24" r="3" className={PAPER} strokeWidth={W} />
      <circle cx="36" cy="24" r="3.6" className={`${ACCENT_FILL} ${POP}`} style={at(200)} />
    </>
  ),
  fit: () => (
    <>
      {[15, 24, 33].map((y, i) => (
        <g key={y}>
          <Draw d={`M9 ${y}l2.5 2.5 4.5-5`} w={1.8} delay={150 + i * 120} />
          <path d={`M20 ${y}h${[18, 14, 16][i]}`} className={FAINT} strokeWidth="1.8" />
        </g>
      ))}
    </>
  ),
  mic: () => (
    <>
      <rect x="19" y="9" width="10" height="18" rx="5" className={PAPER} strokeWidth={W} />
      <Draw d="M14 23a10 10 0 0 0 20 0M24 33v5M19 38h10" w={1.7} />
    </>
  ),
  offer: () => (
    <>
      <Page x={11} y={9} w={21} h={29} n={3} accent={false} />
      <circle cx="31" cy="32" r="5.5" className={`fill-white dark:fill-zinc-900 ${ACCENT}`} strokeWidth="1.6" />
      <Draw d="M28.5 32l2 2 3.5-3.8" w={1.6} delay={300} />
    </>
  ),
  copilot: () => (
    <>
      <path d="M13 26v-3a11 11 0 0 1 22 0v3" className={INK} strokeWidth={W} />
      <rect x="10" y="24" width="6" height="10" rx="2.5" className={`fill-white dark:fill-zinc-900 ${ACCENT}`} strokeWidth="1.8" />
      <rect x="32" y="24" width="6" height="10" rx="2.5" className={PAPER} strokeWidth={W} />
      <Draw d="M21 36h.1M24 33v6M27 35v2" w={2.2} />
    </>
  ),
} satisfies Record<string, () => ReactNode>;

export type SpotKind = keyof typeof SPOTS;
/** Every spot, for the dev gallery. */
export const SPOT_KINDS = Object.keys(SPOTS) as SpotKind[];

/**
 * A spot graphic: `kind` from the set above, 40 px on its tile (`size` "lg": 56 px; `bare`: no tile, for a dark or
 * tinted surface). Decorative.
 */
export function Spot({ kind, size = "md", bare = false, className }: { kind: SpotKind; size?: "md" | "lg"; bare?: boolean; className?: string }) {
  const [ref, shown] = useShown<SVGSVGElement>();
  const draw = SPOTS[kind];
  return (
    <span
      aria-hidden="true"
      className={cx(
        "spot inline-flex shrink-0 items-center justify-center",
        size === "lg" ? "h-14 w-14 rounded-2xl" : "h-10 w-10 rounded-xl",
        !bare && "bg-zinc-50 ring-1 ring-inset ring-zinc-200 dark:bg-white/[0.04] dark:ring-white/10",
        className,
      )}
    >
      <svg
        ref={ref}
        viewBox="0 0 48 48"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        data-shown={shown ? "" : undefined}
        className="scene h-full w-full overflow-visible"
      >
        <g className={NUDGE}>{draw()}</g>
      </svg>
    </span>
  );
}
