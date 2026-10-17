import { ACCENT, ACCENT_FILL, ACCENT_SOFT, BAR, BAR_LINE, FADE, LINE, PAPER, SPARK, Scene, Stars, at, type SceneProps } from "./parts";

export type WorkingKind = "reading" | "writing" | "matching";

const LINES = [44, 36, 48, 30, 42, 46, 26, 40];

/** A page: its title and `lines` lines of text. */
function Page({ x, y, w, h, lines }: { x: number; y: number; w: number; h: number; lines: number }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx="6" className={PAPER} />
      <rect x={x + 10} y={y + 10} width={w * 0.4} height="4.5" rx="2.25" className={ACCENT_FILL} />
      {LINES.slice(0, lines).map((l, i) => (
        <rect key={i} x={x + 10} y={y + 24 + i * 10} width={(l / 48) * (w - 20)} height="3" rx="1.5" className={BAR} />
      ))}
    </>
  );
}

/**
 * The AI at work, for a wait of more than a couple of seconds: `reading` (a band scans down a page), `writing` (lines
 * write themselves in as the pen bobs) or `matching` (a resume and a job, signals passing between them). The one
 * scene that keeps moving, calmly, for as long as the wait lasts; at Full only.
 */
export function WorkingScene({ kind = "reading", ...props }: SceneProps & { kind?: WorkingKind }) {
  return (
    <Scene {...props}>
      <Stars at={[[20, 26, 1], [226, 20, 0.8], [218, 140, 1], [24, 136, 0.8]]} />
      <g className={FADE}>
        {kind === "matching" && (
          <>
            <Page x={26} y={26} w={70} h={104} lines={7} />
            <rect x="146" y="44" width="70" height="66" rx="8" className={PAPER} />
            <rect x="156" y="56" width="34" height="4.5" rx="2.25" className={BAR} />
            <rect x="156" y="66" width="46" height="3" rx="1.5" className={BAR} />
            <rect x="156" y="74" width="40" height="3" rx="1.5" className={BAR} />
            <circle cx="198" cy="94" r="8" className={`${ACCENT_SOFT} ${ACCENT} scene-breathe`} strokeWidth="1.5" />
            <path d="M104 78h34" className={LINE} strokeDasharray="2 4" />
            {[0, 1, 2].map((i) => (
              <circle key={i} cx="106" cy="78" r="2.6" className={`${ACCENT_FILL} scene-travel`} style={at(i * 800, { x: 30 })} />
            ))}
          </>
        )}
        {kind === "reading" && (
          <>
            <Page x={78} y={18} w={84} h={124} lines={8} />
            <g className="scene-scan" style={at(0, { y: 84 })}>
              <rect x="70" y="36" width="100" height="12" rx="3" className={ACCENT_SOFT} />
              <path d="M70 42h100" className={ACCENT} strokeWidth="1.5" />
            </g>
          </>
        )}
        {kind === "writing" && (
          <>
            <rect x="78" y="18" width="84" height="124" rx="6" className={PAPER} />
            <rect x="88" y="28" width="34" height="4.5" rx="2.25" className={ACCENT_FILL} />
            {LINES.slice(0, 7).map((l, i) => (
              <path key={i} d={`M88 ${46 + i * 12}h${(l / 48) * 64}`} pathLength={1} strokeWidth="3" className={`${BAR_LINE} scene-write`} style={at(i * 420)} />
            ))}
            <g className="scene-scan" style={at(0, { y: -3 })}>
              <path d="M150 117l12-28 6 3-12 28zM150 117l6 3-8 4z" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
            </g>
          </>
        )}
        {kind !== "matching" && <path d={SPARK(186, 30, 5)} className={`${ACCENT_FILL} scene-breathe`} />}
      </g>
    </Scene>
  );
}
