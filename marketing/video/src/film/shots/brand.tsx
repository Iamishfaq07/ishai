// The brand scenes: Orbit's mark drawn on, the journey as one orbit, and the end card.
import type { Fmt, Scene } from "../engine";
import { clamp, ep, inOut, lerp, out4, outBack, prog } from "../anim";
import { ACCENT, ACCENT4, AURORA, Backdrop, FONT, INK, INK3, Logo, Words, abs, fs } from "../ui";

/** White opens from the centre; the mark draws on; "One account. From resume to offer." */
export function revealShot(fmt: Fmt, r: { from: number; to: number; logoAt: number; lineAt: number; line?: string }): Scene {
  const { from, to } = r;
  const h = fs(fmt, 150, 150, 136);
  return {
    id: `reveal-${from}`, from, to,
    cues: [{ t: r.logoAt + 0.05, kind: "bloom" }, { t: r.logoAt + 1.0, kind: "sparkle", gain: 0.7 }],
    render: (t) => {
      const lift = ep(t, r.lineAt - 0.2, r.lineAt + 0.6, inOut);
      const out = ep(t, to - 0.55, to, inOut);
      return (
        <>
          <Backdrop fmt={fmt} mode="light" t={t} z={1} />
          <div style={abs({ left: 0, right: 0, top: fmt.h / 2 - h / 2 - lift * h * 0.62, zIndex: 20, display: "flex", justifyContent: "center", transform: `scale(${1 - out * 0.35})`, opacity: 1 - out })}>
            <Logo t={t} at={r.logoAt} height={h} word wordAt={r.logoAt + 0.65} id={`rv${from}`} />
          </div>
          <div style={abs({ left: 0, right: 0, top: fmt.h / 2 + h * 0.18, zIndex: 20, display: "flex", justifyContent: "center", opacity: 1 - out, transform: `translateY(${-out * 40}px)` })}>
            <Words text={r.line ?? (fmt.id === "16x9" ? "One account. *From resume to offer.*" : "One account.\n*From resume to offer.*")} t={t} at={r.lineAt} size={fs(fmt, 68, 74, 66)} align="center" />
          </div>
        </>
      );
    },
  };
}

const STOPS = ["Resume", "Jobs", "Practice", "Interview day", "Offer"];

/** The journey as an orbit: five stops lit in turn, the camera falls into the first. */
export function journeyShot(fmt: Fmt, r: { from: number; to: number; diveAt?: number }): Scene {
  const { from, to } = r;
  const dive = r.diveAt ?? to - 0.6;
  const W = fmt.w;
  const H = fmt.h;
  const upright = fmt.portrait;
  const rx = fmt.id === "16x9" ? 720 : upright ? 300 : 400;
  const ry = fmt.id === "16x9" ? 250 : fmt.id === "9x16" ? 560 : fmt.id === "4x5" ? 430 : 300;
  const cx = upright ? W / 2 + 120 : W / 2;
  const cy = H / 2 + (fmt.id === "9x16" ? 30 : 30);
  // the stops along the front of the orbit: left to right on a wide frame, top to bottom down the left upright
  const angles = upright ? [138, 159, 180, 201, 222] : fmt.square ? [200, 240, 270, 300, 340] : [190, 235, 270, 305, 350];
  const pts = angles.map((a) => [cx + rx * Math.cos((a * Math.PI) / 180), cy - ry * Math.sin((a * Math.PI) / 180)] as const);
  return {
    id: `journey-${from}`, from, to,
    cues: STOPS.map((_, i) => ({ t: from + 0.3 + i * 0.16, kind: "note", step: i, gain: 0.7 })).concat([{ t: dive, kind: "whoosh", dur: 0.6 }]),
    render: (t) => {
      const draw = ep(t, from, from + 0.65, inOut);
      const d = ep(t, dive, to, (x) => x * x * x);
      const [fx, fy] = pts[0]!;
      const zoom = lerp(1, 7, d);
      const len = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2);
      return (
        <>
          <Backdrop fmt={fmt} mode="light" t={t} z={1} />
          <div style={abs({ inset: 0, zIndex: 10, transformOrigin: `${fx}px ${fy}px`, transform: `scale(${zoom})`, opacity: 1 - ep(t, to - 0.25, to) })}>
            <svg width={W} height={H} style={abs({ left: 0, top: 0 })}>
              <defs>
                <linearGradient id={`jr${from}`} x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0" stopColor={ACCENT} />
                  <stop offset="0.5" stopColor={ACCENT4} />
                  <stop offset="1" stopColor={AURORA} />
                </linearGradient>
              </defs>
              <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={`url(#jr${from})`} strokeWidth={upright ? 5 : 4} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - draw)} transform={upright ? undefined : `rotate(${fmt.id === "16x9" ? -6 : -10} ${cx} ${cy})`} />
            </svg>
            {pts.map(([x, y], i) => {
              const a = from + 0.3 + i * 0.16;
              const p = ep(t, a, a + 0.4, outBack);
              const glow = ep(t, a, a + 0.15) * (1 - ep(t, a + 0.2, a + 0.6)) * 0.6 + 0.4;
              const size = fs(fmt, 26, 30, 28);
              return (
                <div key={i} style={abs({ left: x, top: y, transform: upright ? `translate(-${size / 2}px,-50%) scale(${p})` : `translate(-50%,-50%) scale(${p})`, transformOrigin: upright ? `${size / 2}px 50%` : "50% 50%", display: "flex", flexDirection: upright ? "row" : "column", alignItems: "center", gap: upright ? 22 : 14 })}>
                  <div style={{ width: size, height: size, borderRadius: 99, background: "#fff", border: `${size * 0.22}px solid ${ACCENT}`, boxShadow: `0 0 0 ${size * 0.5 * glow}px rgba(134,102,255,0.18)` }} />
                  <div style={{ font: `600 ${fs(fmt, 30, 34, 32)}px/1 ${FONT}`, color: INK, whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>{STOPS[i]}</div>
                </div>
              );
            })}
          </div>
        </>
      );
    },
  };
}

/** The end card: the logo, the promise, "Free to start", the address (and where Orbit runs). */
export function endShot(fmt: Fmt, r: { from: number; to: number; logoAt?: number; lineAt?: number; freeAt?: number; tagline?: string; small?: string }): Scene {
  const { from, to } = r;
  const logoAt = r.logoAt ?? from + 0.15;
  const lineAt = r.lineAt ?? logoAt + 0.9;
  const freeAt = r.freeAt ?? lineAt + 0.8;
  const h = fs(fmt, 150, 140, 126);
  return {
    id: `end-${from}`, from, to,
    cues: [{ t: logoAt, kind: "logo" }],
    render: (t) => {
      const p = ep(t, freeAt, freeAt + 0.7, out4);
      const fade = ep(t, to - 0.35, to);
      return (
        <>
          <Backdrop fmt={fmt} mode="light" t={t} z={1} />
          <div style={abs({ inset: 0, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: fs(fmt, 34, 40, 34), paddingBottom: fmt.id === "9x16" ? 120 : 0, opacity: 1 - fade })}>
            <Logo t={t} at={logoAt} height={h} word wordAt={logoAt + 0.55} id={`end${from}`} />
            <Words text={r.tagline ?? (fmt.id === "16x9" ? "Interview-ready, from resume to offer." : "Interview-ready,\nfrom resume to offer.")} t={t} at={lineAt} size={fs(fmt, 60, 64, 58)} align="center" />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, opacity: p, transform: `translateY(${(1 - p) * 18}px)` }}>
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <span style={{ padding: `${fs(fmt, 17, 18, 16)}px ${fs(fmt, 32, 32, 30)}px`, borderRadius: 14, background: ACCENT, color: "#fff", font: `600 ${fs(fmt, 38, 40, 36)}px/1 ${FONT}`, boxShadow: "0 14px 34px -12px rgba(112,72,245,0.65)" }}>Free to start</span>
                <span style={{ font: `600 ${fs(fmt, 44, 44, 40)}px/1 ${FONT}`, color: INK, letterSpacing: "-0.015em" }}>orbitanswer.com</span>
              </div>
              <div style={{ font: `500 ${fs(fmt, 26, 28, 26)}px/1 ${FONT}`, color: INK3, opacity: clamp(ep(t, freeAt + 0.4, freeAt + 1.0)) }}>{r.small ?? "Windows app · Web"}</div>
            </div>
          </div>
        </>
      );
    },
  };
}

export const _b = { prog };
