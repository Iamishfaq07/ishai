import { ACCENT, BAR, IN, LINE, NUDGE, PAPER, POP, Person, Scene, Stars, at, type SceneProps } from "./parts";

const WAVE = [5, 10, 16, 9, 14, 7, 4];

/** The video interview: a call window with the interviewer asking, your own small picture, and her voice. */
export function VideoScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[16, 22, 1], [230, 98, 0.8], [214, 146, 1], [22, 130, 0.8], [120, 10, 0.8]]} />
      <g className={IN}>
        <rect x="22" y="20" width="152" height="104" rx="10" className={PAPER} />
        <circle cx="98" cy="27" r="1.6" className="fill-zinc-300 dark:fill-white/25" />
        {/* You, in the corner. */}
        <rect x="136" y="90" width="30" height="26" rx="4" className={PAPER} />
        <circle cx="151" cy="99" r="4" className={LINE} />
        <path d="M144 114a7 5 0 0 1 14 0" className={LINE} />
      </g>
      {/* The interviewer: a badge, no likeness. */}
      <g className={POP} style={at(200)}>
        <Person x={92} y={74} r={30} accent />
      </g>
      {/* Her question, and her voice. */}
      <g className={NUDGE}>
        <g className={IN} style={at(450, { x: -8, y: 0 })}>
          <path d="M184 34a8 8 0 0 1 8-8h28a8 8 0 0 1 8 8v12a8 8 0 0 1-8 8h-22l-8 7v-7a6 6 0 0 1-6-6z" className={PAPER} />
          <rect x="192" y="35" width="26" height="3" rx="1.5" className={BAR} />
          <rect x="192" y="42" width="16" height="3" rx="1.5" className={BAR} />
        </g>
      </g>
      <g className={ACCENT} strokeWidth="2.5">
        {WAVE.map((h, i) => (
          <path key={i} d={`M${80 + i * 4.5} ${140 - h / 2}v${h}`} className="scene-pulse" style={at(700 + i * 60)} />
        ))}
      </g>
    </Scene>
  );
}
