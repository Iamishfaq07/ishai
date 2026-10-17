import { ACCENT, BAR, BAR_LINE, DRAW, IN, LABEL, NUDGE, PAPER, Scene, Stars, Tick, at, type SceneProps } from "./parts";

// The code, line by line: [indent, words as [length, accent]].
const CODE: Array<[number, Array<[number, boolean]>]> = [
  [0, [[18, true], [36, false]]],
  [10, [[14, true], [34, false]]],
  [20, [[52, false]]],
  [20, [[28, false], [14, true]]],
  [10, [[22, true]]],
];

/** Code AI: a code window, its cursor waiting at the next line, and the tests beside it passing one by one. */
export function CodeScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[16, 20, 1], [228, 24, 0.8], [220, 140, 1], [20, 144, 0.8], [150, 12, 1]]} />
      <g className={IN}>
        <rect x="18" y="22" width="134" height="112" rx="9" className={PAPER} />
        <path d="M18 38h134" className="stroke-zinc-200 dark:stroke-white/10" />
        <circle cx="29" cy="30" r="2" className={BAR} />
        <circle cx="36" cy="30" r="2" className={BAR} />
        <circle cx="43" cy="30" r="2" className={BAR} />
      </g>
      {CODE.map(([indent, words], i) => {
        let x = 30 + indent;
        return words.map(([w, accent], j) => {
          const d = `M${x} ${54 + i * 11}h${w}`;
          x += w + 5;
          return (
            <path
              key={`${i}-${j}`}
              d={d}
              pathLength={1}
              strokeWidth="3"
              strokeOpacity={accent ? 0.6 : undefined}
              className={`${accent ? ACCENT : BAR_LINE} ${DRAW}`}
              style={at(120 + i * 90 + j * 40)}
            />
          );
        });
      })}
      {/* The cursor, at the next line. */}
      <path d="M30 104v10" className={`${ACCENT} scene-blink`} strokeWidth="1.5" style={at(900)} />
      {/* The tests. */}
      <g className={NUDGE}>
        <g className={IN} style={at(300, { x: 8, y: 0 })}>
          <rect x="162" y="38" width="62" height="80" rx="8" className={PAPER} />
          <text x="172" y="54" className={LABEL}>
            Tests
          </text>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <Tick x={176} y={70 + i * 16} r={5} delay={600 + i * 160} />
              <rect x="186" y={68.5 + i * 16} width={i === 1 ? 22 : 28} height="3" rx="1.5" className={BAR} />
            </g>
          ))}
        </g>
      </g>
    </Scene>
  );
}
