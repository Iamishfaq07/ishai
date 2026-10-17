import { ACCENT, ACCENT_FILL, ACCENT_SOFT, DRAW, IN, LINE, NUDGE, PAPER, POP, Scene, Stars, at, type SceneProps } from "./parts";

/** Two-step sign-in and passkeys: a shield that closes with a tick, its key, and the six-digit code going in. */
export function SecurityScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[20, 24, 1], [226, 22, 0.8], [216, 104, 1], [24, 136, 0.8], [148, 12, 0.8]]} />
      <path d="M86 22l40 14v32c0 30-18 48-40 56-22-8-40-26-40-56V36z" className={`${ACCENT_SOFT} ${ACCENT}`} strokeWidth="1.5" />
      <path d="M86 32l30 10.5v25.5c0 23-13.5 37-30 43.5-16.5-6.5-30-20.5-30-43.5V42.5z" pathLength={1} className={`${ACCENT} ${DRAW}`} strokeOpacity="0.4" />
      <path d="M73 72l9 9 18-20" pathLength={1} className={`${ACCENT} ${DRAW}`} strokeWidth="3" style={at(450)} />
      {/* The key. */}
      <g className={NUDGE}>
        <g className={IN} style={at(250, { x: 10, y: -6 })}>
          <path d="M172 62l38 38M196 86l-7 7M204 94l-6 6" className={LINE} strokeWidth="3" />
          <circle cx="166" cy="56" r="15" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
          <circle cx="162" cy="52" r="4.5" className={ACCENT} strokeWidth="1.5" />
        </g>
      </g>
      {/* The code: three digits in, three to go. */}
      <rect x="140" y="118" width="84" height="22" rx="7" className={PAPER} />
      {[0, 1, 2, 3, 4, 5].map((i) =>
        i < 3 ? (
          <circle key={i} cx={153 + i * 11.6} cy="129" r="2.6" className={`${ACCENT_FILL} ${POP}`} style={at(650 + i * 120)} />
        ) : (
          <circle key={i} cx={153 + i * 11.6} cy="129" r="2.6" className="fill-zinc-200 dark:fill-white/15" />
        ),
      )}
    </Scene>
  );
}
