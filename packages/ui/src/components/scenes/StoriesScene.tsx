import { ACCENT, ACCENT_FILL, ACCENT_SOFT, BAR, LABEL, LINE, PAPER, Scene, Stars, type SceneProps } from "./parts";

const STAR = ["S", "T", "A", "R"];

/** The story bank: an open book of your examples, each told in four parts (situation, task, action, result). */
export function StoriesScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[18, 24, 1], [224, 20, 0.8], [230, 128, 1], [16, 132, 0.8], [120, 10, 0.8]]} />
      {/* The open book. */}
      <path d="M120 40c-22-12-52-14-78-6v96c26-8 56-6 78 6z" className={PAPER} />
      <path d="M120 40c22-12 52-14 78-6v96c-26-8-56-6-78 6z" className={PAPER} />
      <path d="M120 40v96" className={LINE} />
      {/* Its ribbon. */}
      <path d="M168 31v34l6-5 6 5V32" className={`${ACCENT_SOFT} ${ACCENT}`} strokeWidth="1.5" />
      {/* The left page: a story's lines. */}
      <rect x="54" y="52" width="40" height="4" rx="2" className={ACCENT_FILL} />
      <rect x="54" y="64" width="54" height="3" rx="1.5" className={BAR} />
      <rect x="54" y="72" width="48" height="3" rx="1.5" className={BAR} />
      <rect x="54" y="80" width="52" height="3" rx="1.5" className={BAR} />
      <rect x="54" y="96" width="44" height="3" rx="1.5" className={BAR} />
      <rect x="54" y="104" width="50" height="3" rx="1.5" className={BAR} />
      {/* The right page: its four parts. */}
      {STAR.map((letter, i) => {
        const y = 56 + i * 18;
        const done = i < 3;
        return (
          <g key={letter}>
            <circle cx="138" cy={y} r="6" className={done ? `${ACCENT_SOFT} ${ACCENT}` : LINE} />
            <text x="138" y={y + 3} textAnchor="middle" className={LABEL}>
              {letter}
            </text>
            <rect x="150" y={y - 1.5} width={done ? 30 : 20} height="3" rx="1.5" className={BAR} />
          </g>
        );
      })}
    </Scene>
  );
}
