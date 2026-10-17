import { ACCENT, ACCENT_FILL, ACCENT_SOFT, BAR, FADE, IN, LABEL, LINE, NUDGE, PAPER, POP, Scene, Stars, at, type SceneProps } from "./parts";

/**
 * The interview copilot: a headset listening, and the transcript where the question is caught and answered; its
 * waveform pulses. `quiet`: nothing was heard (a flat line, an empty transcript).
 */
export function CopilotScene({ quiet = false, ...props }: SceneProps & { quiet?: boolean }) {
  return (
    <Scene {...props}>
      <Stars at={[[18, 22, 1], [36, 132, 0.8], [118, 14, 1], [226, 138, 0.8], [104, 140, 1]]} />
      {/* The headset. */}
      <g className={NUDGE}>
        <g className={IN}>
          <path d="M30 86V72a30 30 0 0 1 60 0v14" className={LINE} strokeWidth="1.5" />
          <rect x="22" y="80" width="16" height="28" rx="6" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
          <rect x="82" y="80" width="16" height="28" rx="6" className={PAPER} />
          <path d="M38 102q16 18 34 12" className={LINE} />
          <circle cx="73" cy="113.5" r="3" className={ACCENT_FILL} />
        </g>
      </g>
      {/* What it hears, going to the transcript. */}
      {quiet ? (
        <path d="M106 84h16" className={LINE} strokeWidth="1.5" />
      ) : (
        <g className={ACCENT} strokeWidth="1.5" strokeOpacity="0.7">
          {["M108 78v12", "M114 72v24", "M120 80v8"].map((d, i) => (
            <path key={d} d={d} className="scene-pulse" style={at(300 + i * 90)} />
          ))}
        </g>
      )}
      {/* The transcript: the interviewer's question, caught; the answer, ready. */}
      <rect x="132" y="24" width="94" height="112" rx="9" className={PAPER} />
      <text x="142" y="42" className={LABEL}>
        Question
      </text>
      {quiet ? (
        <rect x="142" y="48" width="74" height="18" rx="5" className={LINE} strokeDasharray="3 3" />
      ) : (
        <g className={POP} style={at(450)}>
          <rect x="142" y="48" width="74" height="18" rx="5" className={`${ACCENT_SOFT} ${ACCENT}`} />
          <rect x="148" y="55" width="50" height="3.5" rx="1.75" className="fill-indigo-500/60 dark:fill-indigo-400/60" />
        </g>
      )}
      <text x="142" y="84" className={LABEL}>
        Answer
      </text>
      {!quiet &&
        [70, 62, 68, 40].map((w, i) => (
          <rect key={i} x="142" y={91 + i * 8} width={w} height="3" rx="1.5" className={`${BAR} ${FADE}`} style={at(650 + i * 80)} />
        ))}
    </Scene>
  );
}
