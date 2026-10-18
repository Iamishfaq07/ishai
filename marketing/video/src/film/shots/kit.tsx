// Building blocks for scenes with the app in them: a camera over an app frame, the words beside it, a cursor that
// presses the same buttons the frame's script presses.
import type { ReactNode } from "react";
import type { Ctx, Cue, Fmt, FrameLayout, FrameSpec, Query, Scene } from "../engine";
import { clamp, ep, inOut, lerp, out4, outExpo, prog } from "../anim";
import { Backdrop, Cursor, Eyebrow, Words, abs, fs, type CursorKey } from "../ui";

export type Target = { sel?: string; text?: string; row?: string };
/** A camera key: at film time `t`, app point (fx, fy) (or an element's centre) sits at the frame's anchor, scaled. */
export type Cam = { t: number; fx?: number; fy?: number; el?: Target; z?: number; dx?: number; dy?: number; e?: (x: number) => number };

export type Placement = { sx: number; sy: number; scale: number; anchor?: boolean };

/** Feature films show the phone layout in square frames too (feeds show them small: the phone's type stays legible). */
export const LAYOUT = { phoneSquare: false };
export const phoneLike = (fmt: Fmt): boolean => fmt.portrait || (fmt.square && LAYOUT.phoneSquare);

/** The usual place for an app window in each format, and the window size its layout gets. */
export function placement(fmt: Fmt, kind: "desk" | "phone" | "deskWide" = phoneLike(fmt) ? "phone" : "desk"): { vp: [number, number]; p: Placement } {
  if (kind === "phone") {
    if (fmt.id === "1x1") return { vp: [400, 860], p: { sx: fmt.w / 2, sy: 270 + (860 * 1.5) / 2, scale: 1.5 } };
    if (fmt.id === "9x16") return { vp: [390, 844], p: { sx: fmt.w / 2, sy: 560 + (844 * 2.04) / 2, scale: 2.04 } };
    return { vp: [390, 844], p: { sx: fmt.w / 2, sy: 330 + (844 * 1.84) / 2, scale: 1.84 } }; // 4:5
  }
  if (fmt.id === "16x9") {
    if (kind === "deskWide") return { vp: [1280, 800], p: { sx: fmt.w / 2, sy: fmt.h / 2 + 10, scale: 1.12 } };
    return { vp: [1280, 800], p: { sx: 1372, sy: fmt.h / 2 + 4, scale: 1.04 } };
  }
  if (fmt.id === "1x1") return { vp: [1100, 860], p: { sx: fmt.w / 2, sy: 250 + (860 * 0.9) / 2, scale: 0.9, anchor: true } };
  // portrait formats with a desktop window: full width
  return { vp: [1280, 800], p: { sx: fmt.w / 2, sy: fmt.h / 2 + 80, scale: 0.8, anchor: true } };
}

/** A layout function: the camera keys eased one into the next, an entrance and an exit. */
export function camera(
  spec: { vp: [number, number]; p: Placement },
  cams: Cam[],
  o: { enter?: [number, number]; exit?: [number, number]; from?: "right" | "bottom" | "left" | "fade" | "rise"; to?: "left" | "fade" | "up" | "right" | "back"; tilt?: number; lift?: number; dim?: (t: number) => number; anchorTop?: boolean } = {},
): (t: number, q: Query) => FrameLayout {
  const [vw, vh] = spec.vp;
  // Upright frames sit under their title: a zoom grows downwards from the top edge, and moves nothing sideways.
  const top = o.anchorTop ?? spec.p.anchor ?? spec.vp[0] <= 420;
  return (t, q) => {
    const pt = (c: Cam) => {
      if (c.el) {
        const r = q(c.el.sel ?? "*", c.el.text);
        if (r) return [r.x + r.w / 2, r.y + r.h / 2] as const;
      }
      return [c.fx ?? vw / 2, c.fy ?? vh / 2] as const;
    };
    let fx = vw / 2;
    let fy = vh / 2;
    let z = 1;
    let dx = 0;
    let dy = 0;
    if (cams.length) {
      const first = cams[0]!;
      [fx, fy] = pt(first);
      z = first.z ?? 1;
      dx = first.dx ?? 0;
      dy = first.dy ?? 0;
      for (let i = 1; i < cams.length; i++) {
        const a = cams[i - 1]!;
        const b = cams[i]!;
        if (t <= a.t) break;
        const p = (b.e ?? inOut)(prog(t, a.t, b.t));
        const [ax, ay] = pt(a);
        const [bx, by] = pt(b);
        fx = lerp(ax, bx, p);
        fy = lerp(ay, by, p);
        z = lerp(a.z ?? 1, b.z ?? 1, p);
        dx = lerp(a.dx ?? 0, b.dx ?? 0, p);
        dy = lerp(a.dy ?? 0, b.dy ?? 0, p);
      }
    }
    if (top) z = Math.min(z, 1.08); // no deep zooms where the frame fills the width: the app scrolls instead
    const scale = spec.p.scale * z;
    let cx = spec.p.sx + dx - (fx - vw / 2) * scale;
    let cy = spec.p.sy + dy - (fy - vh / 2) * scale;
    if (top) {
      cx = spec.p.sx + dx;
      cy = spec.p.sy - (vh / 2) * spec.p.scale + (vh / 2) * scale + dy;
    }
    let opacity = 1;
    let ry = 0;
    let rx = 0;
    let blur = 0;
    const W = 2200;
    if (o.enter) {
      const p = outExpo(prog(t, o.enter[0], o.enter[1]));
      const from = o.from ?? "rise";
      if (from === "right") {
        cx += (1 - p) * W * 0.55;
        ry = (1 - p) * -(o.tilt ?? 14);
      } else if (from === "left") {
        cx -= (1 - p) * W * 0.55;
        ry = (1 - p) * (o.tilt ?? 14);
      } else if (from === "bottom") cy += (1 - p) * 900;
      else if (from === "rise") {
        cy += (1 - p) * 140;
        rx = (1 - p) * (o.tilt ?? 16);
      }
      opacity = clamp(ep(t, o.enter[0], o.enter[0] + (o.enter[1] - o.enter[0]) * 0.5, out4));
      blur = (1 - p) * 6;
    }
    if (o.exit) {
      const p = inOut(prog(t, o.exit[0], o.exit[1]));
      const to = o.to ?? "left";
      if (to === "left") {
        cx -= p * W * 0.5;
        ry += p * 12;
      } else if (to === "right") cx += p * W * 0.5;
      else if (to === "up") cy -= p * 900;
      else if (to === "back") {
        opacity *= 1 - p;
        blur += p * 10;
        return { cx, cy, scale: scale * (1 - 0.12 * p), opacity, rx, ry, blur, lift: o.lift, dim: o.dim?.(t) };
      }
      opacity *= 1 - prog(t, o.exit[0] + (o.exit[1] - o.exit[0]) * 0.4, o.exit[1]);
      blur += p * 8;
    }
    return { cx, cy, scale, opacity, rx, ry, blur, lift: o.lift, dim: o.dim?.(t) };
  };
}

/** Script steps that press buttons, and the cursor keys that go with them (the press lands at the step's time). */
export type Press = { at: number; target: Target; frame: string; click?: boolean; dwell?: number };
// Where each press landed, kept once it happened: the button may be gone a moment later ("Add all" goes when used).
const landed = new Map<string, { x: number; y: number }>();

export function cursorKeys(ctx: Ctx, presses: Press[], start: { x: number; y: number; t: number }): CursorKey[] {
  const keys: CursorKey[] = [start];
  for (const [i, p] of presses.entries()) {
    const id = `${p.frame}|${i}|${p.at}`;
    let pos = ctx.t > p.at ? landed.get(id) : undefined;
    if (!pos) {
      const r = ctx.rect(p.frame, p.target.sel ?? "button, a, [role=tab], [role=radio], label, summary", p.target.text, p.target.row);
      if (r) pos = { x: r.x + Math.min(r.w * 0.5, 60), y: r.y + r.h * 0.55 };
      if (pos && ctx.t >= p.at - 0.12 && ctx.t <= p.at + 0.05) landed.set(id, pos);
    }
    if (!pos) continue;
    const { x, y } = pos;
    keys.push({ t: p.at - (p.dwell ?? 0.75), x, y });
    keys.push({ t: p.at, x, y, click: p.click !== false });
  }
  return keys;
}

/** The title block of a scene: eyebrow and words, placed for the format. */
export function TitleBlock({ fmt, t, at, out, eyebrow, title, align, x, y, size, width, dark }: {
  fmt: Fmt; t: number; at: number; out?: number; eyebrow?: string; title: string; align?: "left" | "center"; x?: number; y?: number; size?: number; width?: number; dark?: boolean;
}) {
  const left = fmt.id === "16x9" && align !== "center";
  const s = size ?? fs(fmt, 58, 64, 58);
  const top = y ?? (fmt.id === "16x9" ? 360 : fmt.id === "9x16" ? fmt.safe.t + 28 : fmt.id === "4x5" ? 70 : 62);
  return (
    <div style={abs({ left: x ?? (left ? 104 : 0), top, width: width ?? (left ? 560 : fmt.w), zIndex: 30, textAlign: left ? "left" : "center", display: "flex", flexDirection: "column", alignItems: left ? "flex-start" : "center", gap: s * 0.32 })}>
      {eyebrow && <Eyebrow text={eyebrow} t={t} at={at} out={out} size={fmt.id === "16x9" ? 25 : 28} dark={dark} />}
      <Words text={title} t={t} at={at + 0.12} out={out} size={s} align={left ? "left" : "center"} color={dark ? "#fff" : undefined} />
    </div>
  );
}

/** A scene with app frames, a title, a cursor, and whatever else it draws. */
export function stop(o: {
  id: string; fmt: Fmt; from: number; to: number; frames: FrameSpec[]; presses?: Press[]; cursorFrom?: { x: number; y: number };
  draw?: (t: number, ctx: Ctx) => ReactNode; cues?: Cue[]; cursorScale?: number; backdrop?: "light" | "mist" | "ink" | "none";
}): Scene {
  return {
    id: o.id,
    from: o.from,
    to: o.to,
    frames: o.frames,
    cues: [...(o.cues ?? []), ...(o.presses ?? []).filter((p) => p.click !== false).map((p) => ({ t: p.at, kind: "click", gain: 0.9 }))],
    render: (t, ctx) => {
      const presses = o.presses ?? [];
      const keys = presses.length ? cursorKeys(ctx, presses, { t: presses[0]!.at - 1.4, x: o.cursorFrom?.x ?? o.fmt.w * 0.82, y: o.cursorFrom?.y ?? o.fmt.h * 0.92 }) : [];
      return (
        <>
          {o.backdrop !== "none" && <Backdrop fmt={o.fmt} mode={o.backdrop ?? "mist"} t={t} z={1} />}
          {o.draw?.(t, ctx)}
          {keys.length > 1 && (
            <Cursor t={t} keys={keys} show={keys[0]!.t} hide={presses[presses.length - 1]!.at + 0.7} scale={o.cursorScale ?? (o.fmt.id === "16x9" ? 1.1 : 1.5)} />
          )}
        </>
      );
    },
  };
}

/** A frame's script step that presses a target, as a Press the cursor follows too. */
export function press(frame: string, at: number, target: Target, dwell?: number): Press {
  return { frame, at, target, dwell };
}
export function stepsOf(presses: Press[], from: number): Array<Record<string, unknown> & { at: number }> {
  return presses.map((p) => ({ at: p.at - from, click: { sel: p.target.sel, text: p.target.text, row: p.target.row } }));
}

export const HIDE_TOASTS = 'section[aria-label="Notifications"] { display: none !important; }';
