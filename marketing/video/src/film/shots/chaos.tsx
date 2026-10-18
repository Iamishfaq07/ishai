// The job search before Orbit: pieces of it drifting in the dark (the resume in versions, the tabs, the spreadsheet,
// the calendar), then pulled into one point. Drawn here (no product in it): plain shapes in the site's style, no
// logos, made-up names.
import type { CSSProperties, ReactNode } from "react";
import type { Fmt, Scene } from "../engine";
import { clamp, ep, in3, inOut, lerp, out3, prog, rand, sway } from "../anim";
import { FONT, INK, INK3, Words, abs, fs } from "../ui";

const card: CSSProperties = {
  background: "#fff", borderRadius: 14, boxShadow: "0 1px 0 rgba(255,255,255,0.4) inset, 0 30px 60px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)",
  font: `500 18px/1.3 ${FONT}`, color: INK, overflow: "hidden",
};

function FileCard({ name, meta }: { name: string; meta: string }) {
  return (
    <div style={{ ...card, width: 340, padding: 18, display: "flex", gap: 14, alignItems: "center" }}>
      <div style={{ width: 44, height: 54, borderRadius: 6, background: "#f1f2f7", border: "1px solid #e1e3ec", position: "relative" }}>
        <div style={abs({ left: 6, right: 6, bottom: 8, height: 14, borderRadius: 3, background: "#e5484d", color: "#fff", font: `700 9px/14px ${FONT}`, textAlign: "center" })}>PDF</div>
      </div>
      <div>
        <div style={{ fontWeight: 600 }}>{name}</div>
        <div style={{ color: INK3, fontSize: 15 }}>{meta}</div>
      </div>
    </div>
  );
}

function Tabs() {
  const tabs = ["Careers", "Jobs", "Careers", "Data analyst", "Openings", "Jobs", "Careers", "Apply", "Jobs"];
  const colors = ["#7048F5", "#0ea5e9", "#f59e0b", "#10b981", "#ef4444", "#6366f1", "#14b8a6", "#ec4899", "#84cc16"];
  return (
    <div style={{ ...card, width: 820, padding: "10px 10px 0", background: "#e9ebf2", display: "flex", gap: 4 }}>
      {tabs.map((t, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, background: i === 4 ? "#fff" : "#dfe2ec", borderRadius: "9px 9px 0 0", padding: "9px 10px", display: "flex", gap: 7, alignItems: "center", fontSize: 14, color: "#4b5068" }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: colors[i], flex: "none" }} />
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t}</span>
        </div>
      ))}
    </div>
  );
}

function Sheet() {
  const rows = [["Company", "Role", "Status", "Next"], ["Kestrel Pay", "Product Analyst", "Interview?", "Tue"], ["Lumen", "Sr Data Analyst", "Applied", "Follow up"], ["Northwind", "Analyst", "??", ""], ["Brightline", "Data Analyst", "Applied", "Fri"]];
  return (
    <div style={{ ...card, width: 520, padding: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.4fr 1fr 0.9fr" }}>
        {rows.flat().map((c, i) => (
          <div key={i} style={{ padding: "9px 12px", fontSize: 15, borderRight: "1px solid #e8e9f0", borderBottom: "1px solid #e8e9f0", background: i < 4 ? "#f3f4f8" : "#fff", fontWeight: i < 4 ? 600 : 400, color: c === "??" || c === "Interview?" ? "#c2410c" : INK }}>
            {c || " "}
          </div>
        ))}
      </div>
    </div>
  );
}

function Calendar() {
  return (
    <div style={{ ...card, width: 300, padding: 18 }}>
      <div style={{ color: "#e5484d", fontWeight: 600, fontSize: 14 }}>TUESDAY 20</div>
      <div style={{ marginTop: 10, borderLeft: "4px solid #7048F5", background: "#f3f0ff", borderRadius: 8, padding: "10px 12px" }}>
        <div style={{ fontWeight: 600 }}>Final round</div>
        <div style={{ color: INK3, fontSize: 15 }}>11:00 – 12:00 · video call</div>
      </div>
    </div>
  );
}

function Sticky({ text }: { text: string }) {
  return <div style={{ ...card, width: 230, padding: "20px 20px 26px", background: "#fff3b8", font: `italic 500 24px/1.25 ${FONT}`, color: "#54470f" }}>{text}</div>;
}

function Mail() {
  return (
    <div style={{ ...card, width: 400, padding: 16, display: "flex", gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: 99, background: "#e8e9f2", flex: "none" }} />
      <div>
        <div style={{ fontWeight: 600 }}>Thank you for applying</div>
        <div style={{ color: INK3, fontSize: 15 }}>We've received your application and will be in touch…</div>
      </div>
    </div>
  );
}

function Search() {
  return (
    <div style={{ ...card, width: 520, padding: "16px 20px", borderRadius: 999, display: "flex", gap: 12, alignItems: "center", color: "#4b5068" }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6e7396" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      data analyst jobs bengaluru hybrid
    </div>
  );
}

function Notes() {
  return (
    <div style={{ ...card, width: 330, padding: 18 }}>
      <div style={{ fontWeight: 600 }}>Questions they might ask</div>
      {["Tell me about yourself", "A time you used data…", "Why this company?", "Salary expectations"].map((q) => (
        <div key={q} style={{ display: "flex", gap: 8, marginTop: 8, color: "#4b5068", fontSize: 16 }}>
          <span style={{ width: 14, height: 14, marginTop: 3, borderRadius: 4, border: "1.5px solid #c4c7dd", flex: "none" }} />
          {q}
        </div>
      ))}
    </div>
  );
}

type Piece = { el: ReactNode; x: number; y: number; z: number; rz: number; ry: number; enter: number };

/**
 * The scene: [from, to]; the pieces arrive from `from`, drift, and are pulled into the centre over [implode, to].
 * `lines`: the words over it, [text, at, out].
 */
export function chaosShot(fmt: Fmt, o: { from: number; to: number; implode: number; lines: Array<[string, number, number]> }): Scene {
  const W = fmt.w;
  const H = fmt.h;
  const portrait = fmt.portrait;
  const sx = portrait ? 0.86 : fmt.square ? 0.8 : 1.12;
  const P = (x: number, y: number) => [W / 2 + x * W * 0.5 * (portrait ? 1.25 : 1), H / 2 + y * H * 0.5 * (portrait ? 0.82 : 1)];
  const pieces: Piece[] = [
    { el: <FileCard name="Resume_final_v7.pdf" meta="Edited 2 days ago" />, ...xy(P(-0.62, -0.55)), z: -200, rz: -6, ry: 14, enter: 0.0 },
    { el: <Tabs />, ...xy(P(0.18, -0.78)), z: -420, rz: 2, ry: -8, enter: 0.25 },
    { el: <Sheet />, ...xy(P(0.62, 0.42)), z: -260, rz: 5, ry: -16, enter: 0.5 },
    { el: <Calendar />, ...xy(P(0.7, -0.2)), z: -120, rz: 7, ry: -18, enter: 0.9 },
    { el: <Sticky text="STAR stories!!" />, ...xy(P(-0.78, 0.25)), z: -160, rz: -9, ry: 18, enter: 1.1 },
    { el: <FileCard name="Resume_FINAL_v8_real.docx" meta="Edited yesterday" />, ...xy(P(-0.3, 0.72)), z: -320, rz: 4, ry: 10, enter: 1.4 },
    { el: <Mail />, ...xy(P(0.36, 0.86)), z: -500, rz: -3, ry: -6, enter: 1.7 },
    { el: <Search />, ...xy(P(-0.18, -0.95)), z: -620, rz: -2, ry: 6, enter: 2.0 },
    { el: <Notes />, ...xy(P(0.98, -0.72)), z: -560, rz: 6, ry: -14, enter: 2.3 },
    { el: <FileCard name="Cover_letter_lumen_v3.pdf" meta="Edited 5 days ago" />, ...xy(P(-0.95, -0.02)), z: -700, rz: -4, ry: 20, enter: 2.6 },
    { el: <Sticky text="follow up with Lumen??" />, ...xy(P(0.08, 0.5)), z: -760, rz: 8, ry: -4, enter: 2.9 },
  ];
  const size = fs(fmt, 92, 76, 74);
  return {
    id: "chaos",
    from: o.from,
    to: o.to,
    cues: [
      { t: o.from, kind: "rumble", dur: o.implode - o.from },
      ...pieces.map((p, i) => ({ t: o.from + 0.2 + p.enter, kind: "tick", gain: 0.5, pan: rand(i) * 1.6 - 0.8 })),
      { t: o.implode - 0.9, kind: "riser", dur: 0.95 },
      { t: o.to - 0.05, kind: "impact" },
    ],
    render: (t) => {
      const local = t - o.from;
      const imp = ep(t, o.implode, o.to, in3);
      const dolly = local * 38;
      return (
        <>
          <div style={abs({ inset: 0, background: "radial-gradient(ellipse 80% 70% at 50% 45%, #141a2a 0%, #0b0f17 55%, #07090f 100%)", zIndex: 1 })} />
          <div style={abs({ inset: 0, perspective: 1400, perspectiveOrigin: "50% 45%", zIndex: 2, filter: imp > 0 ? `blur(${imp * 10}px)` : "none" })}>
            {pieces.map((p, i) => {
              const a = ep(local, p.enter, p.enter + 1.4, out3);
              if (a <= 0) return null;
              const driftX = sway(t, 18, 11 + i, i) + local * (rand(i + 7) - 0.5) * 16;
              const driftY = sway(t, 12, 9 + i * 0.7, i * 2) + local * (rand(i + 3) - 0.5) * 10;
              const x = lerp(p.x + driftX, W / 2, imp);
              const y = lerp(p.y + driftY, H / 2, imp);
              const z = p.z + dolly + (1 - a) * -500 - imp * 900;
              const rz = p.rz + sway(t, 1.8, 13 + i, i) - imp * p.rz;
              return (
                <div key={i} style={abs({ left: x, top: y, transform: `translate(-50%, -50%) translateZ(${z}px) rotateY(${p.ry * (1 - imp)}deg) rotateZ(${rz}deg) scale(${sx})`, opacity: clamp(a * 1.2) * (1 - ep(t, o.to - 0.25, o.to)) * (1 - imp * 0.4) })}>
                  {p.el}
                </div>
              );
            })}
          </div>
          {/* The words, over a soft dark pool so they read */}
          <div style={abs({ inset: 0, zIndex: 5, background: "radial-gradient(ellipse 45% 30% at 50% 50%, rgba(7,9,15,0.82), rgba(7,9,15,0.0) 100%)", opacity: ep(local, 0.2, 1.2) })} />
          {o.lines.map(([text, at, out], i) => (
            <div key={i} style={abs({ left: 0, right: 0, top: H / 2, transform: "translateY(-50%)", zIndex: 6, display: "flex", justifyContent: "center", padding: "0 60px" })}>
              <Words text={text} t={t} at={at} out={out} size={size} color="#fff" align="center" lh={1.06} />
            </div>
          ))}
          {/* The point everything is pulled into */}
          {imp > 0 && (
            <div style={abs({ left: W / 2, top: H / 2, width: 0, height: 0, zIndex: 7 })}>
              <div style={abs({ left: -40 - imp * 60, top: -40 - imp * 60, width: 80 + imp * 120, height: 80 + imp * 120, borderRadius: 999, background: "radial-gradient(closest-side, #fff, rgba(196,181,253,0.8) 40%, rgba(112,72,245,0) 100%)", opacity: imp })} />
            </div>
          )}
        </>
      );
    },
  };
}

function xy(p: number[]): { x: number; y: number } {
  return { x: p[0]!, y: p[1]! };
}

/** The flash from that point to white: a circle opening from the centre over [at, at+dur]. */
export function openWhite(fmt: Fmt, t: number, at: number, dur = 0.7, z = 8): ReactNode {
  const p = ep(t, at, at + dur, inOut);
  if (p <= 0 || p >= 1) return null;
  const r = Math.hypot(fmt.w, fmt.h) * 0.55 * p;
  return <div style={abs({ left: fmt.w / 2 - r, top: fmt.h / 2 - r, width: r * 2, height: r * 2, borderRadius: 9999, background: "#fff", zIndex: z, boxShadow: `0 0 ${80 * (1 - p)}px ${40 * (1 - p)}px rgba(196,181,253,${0.6 * (1 - p)})` })} />;
}

export const _unused = prog;
export const _ink = inOut;
