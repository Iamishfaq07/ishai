import { ACCENT, ACCENT_FILL, BAR, FADE, IN, LABEL, LINE, NUDGE, PAPER, Scene, Stars, at, type SceneProps } from "./parts";

/** Documents: your resume, a job description and notes, fanned out, the copilot's sources for every session. */
export function DocumentsScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[20, 20, 1], [224, 22, 0.8], [228, 132, 1], [18, 128, 0.8], [120, 148, 0.8]]} />
      {/* Notes, behind. */}
      <g className={FADE} style={at(250)}>
        <g transform="rotate(-10 88 84)">
          <rect x="52" y="34" width="70" height="92" rx="7" className={PAPER} />
          <rect x="62" y="48" width="40" height="3" rx="1.5" className={BAR} />
          <rect x="62" y="56" width="48" height="3" rx="1.5" className={BAR} />
        </g>
      </g>
      {/* The job description. */}
      <g className={FADE} style={at(400)}>
        <g transform="rotate(8 156 84)">
          <rect x="120" y="34" width="70" height="92" rx="7" className={PAPER} />
          <rect x="130" y="48" width="34" height="3.5" rx="1.75" className={BAR} />
          <rect x="130" y="58" width="50" height="3" rx="1.5" className={BAR} />
          <rect x="130" y="66" width="44" height="3" rx="1.5" className={BAR} />
        </g>
      </g>
      {/* The resume, on top. */}
      <g className={NUDGE}>
        <g className={IN} style={at(0, { y: 8 })}>
          <rect x="84" y="28" width="72" height="100" rx="7" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
          <rect x="94" y="40" width="36" height="4" rx="2" className={ACCENT_FILL} />
          <rect x="94" y="52" width="52" height="3" rx="1.5" className={BAR} />
          <rect x="94" y="60" width="46" height="3" rx="1.5" className={BAR} />
          <rect x="94" y="68" width="50" height="3" rx="1.5" className={BAR} />
          <rect x="94" y="82" width="30" height="3" rx="1.5" className={BAR} />
          <rect x="94" y="90" width="48" height="3" rx="1.5" className={BAR} />
          <text x="94" y="116" className={LABEL}>
            Resume
          </text>
        </g>
      </g>
      <path d="M40 138h160" className={LINE} />
    </Scene>
  );
}
