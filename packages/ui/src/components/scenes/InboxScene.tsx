import { ACCENT, ACCENT_FILL, IN, LINE, NUDGE, PAPER, POP, Scene, Stars, at, type SceneProps } from "./parts";

/** The admin inbox and support: a letter coming down into the tray, and a chat waiting with its three dots. */
export function InboxScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[20, 22, 1], [64, 14, 0.8], [228, 96, 1], [214, 146, 0.8], [24, 120, 0.8]]} />
      <g className={NUDGE}>
        <g className={IN} style={at(150, { y: -16 })}>
          <rect x="88" y="34" width="60" height="44" rx="4" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
          <path d="M88 38l30 20 30-20" className={ACCENT} strokeWidth="1.5" />
        </g>
      </g>
      {/* The tray, in front of the letter. */}
      <path d="M38 80a6 6 0 0 1 6-6h152a6 6 0 0 1 6 6v46a8 8 0 0 1-8 8H46a8 8 0 0 1-8-8z" className={PAPER} />
      <path d="M38 102h44l8 12h60l8-12h44" className={LINE} />
      <g className={POP} style={at(500)}>
        <path d="M176 18a8 8 0 0 1 8-8h32a8 8 0 0 1 8 8v14a8 8 0 0 1-8 8h-24l-8 7v-7a8 8 0 0 1-8-8z" className={PAPER} />
        {[190, 200, 210].map((x) => (
          <circle key={x} cx={x} cy="25" r="2.2" className={ACCENT_FILL} />
        ))}
      </g>
    </Scene>
  );
}
