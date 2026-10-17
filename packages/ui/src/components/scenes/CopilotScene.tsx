import { ACCENT, ACCENT_FILL, ACCENT_SOFT, BAR, LABEL, LINE, PAPER, Scene, Stars, type SceneProps } from "./parts";

/** The interview copilot: a headset listening, and the transcript where the question is caught and answered. */
export function CopilotScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[18, 22, 1], [36, 132, 0.8], [118, 14, 1], [226, 138, 0.8], [104, 140, 1]]} />
      {/* The headset. */}
      <path d="M30 86V72a30 30 0 0 1 60 0v14" className={LINE} strokeWidth="1.5" />
      <rect x="22" y="80" width="16" height="28" rx="6" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
      <rect x="82" y="80" width="16" height="28" rx="6" className={PAPER} />
      <path d="M38 102q16 18 34 12" className={LINE} />
      <circle cx="73" cy="113.5" r="3" className={ACCENT_FILL} />
      {/* What it hears, going to the transcript. */}
      <g className={ACCENT} strokeWidth="1.5" strokeOpacity="0.7">
        <path d="M108 78v12M114 72v24M120 80v8" className="motion-ok:animate-twinkle" />
      </g>
      {/* The transcript: the interviewer's question, caught; the answer, ready. */}
      <rect x="132" y="24" width="94" height="112" rx="9" className={PAPER} />
      <text x="142" y="42" className={LABEL}>
        Question
      </text>
      <rect x="142" y="48" width="74" height="18" rx="5" className={`${ACCENT_SOFT} ${ACCENT}`} />
      <rect x="148" y="55" width="50" height="3.5" rx="1.75" className="fill-indigo-500/60 dark:fill-indigo-400/60" />
      <text x="142" y="84" className={LABEL}>
        Answer
      </text>
      <rect x="142" y="91" width="70" height="3" rx="1.5" className={BAR} />
      <rect x="142" y="99" width="62" height="3" rx="1.5" className={BAR} />
      <rect x="142" y="107" width="68" height="3" rx="1.5" className={BAR} />
      <rect x="142" y="115" width="40" height="3" rx="1.5" className={BAR} />
    </Scene>
  );
}
