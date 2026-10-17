import { ACCENT, ACCENT_FILL, FADE, LABEL, LINE, PAPER, POP, Scene, Stars, at, pin, type SceneProps } from "./parts";

/** Jobs AI: a constellation of openings, Bengaluru brightest, joined to Pune, Hyderabad and remote work. */
export function JobsScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[24, 22, 1], [52, 120, 0.8], [146, 136, 1.2], [214, 112, 0.8], [104, 18, 1], [222, 82, 1], [30, 76, 0.8]]} />
      <path d="M70 66 128 74 108 116Z" className={LINE} strokeDasharray="2 4" />
      <path d="M128 74 186 50" className={LINE} strokeDasharray="1 4" />
      {/* Bengaluru, with a glow. */}
      <circle cx="108" cy="104" r="17" className="stroke-aurora-400 motion-ok:animate-twinkle" strokeOpacity="0.6" />
      <g className={POP} style={at(150)}>
        <path d={pin(108, 116, 8)} className={`${ACCENT_FILL} ${ACCENT}`} strokeWidth="1.5" />
        <circle cx="108" cy="102.4" r="3" className="fill-white dark:fill-zinc-900" />
      </g>
      <text x="128" y="122" className={LABEL}>Bengaluru</text>
      {/* Pune and Hyderabad. */}
      <path d={pin(70, 66, 6)} className={`${PAPER} ${ACCENT} ${FADE}`} strokeWidth="1.5" style={at(350)} />
      <text x="70" y="42" textAnchor="middle" className={LABEL}>Pune</text>
      <path d={pin(128, 74, 6)} className={`${PAPER} ${ACCENT} ${FADE}`} strokeWidth="1.5" style={at(500)} />
      <text x="136" y="86" className={LABEL}>Hyderabad</text>
      {/* Remote: a small world with its own orbit. */}
      <ellipse cx="186" cy="44" rx="17" ry="6" transform="rotate(-18 186 44)" className={ACCENT} strokeOpacity="0.5" />
      <circle cx="186" cy="44" r="9" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
      <path d="M177.5 44h17M186 35c-4.5 5-4.5 13 0 18M186 35c4.5 5 4.5 13 0 18" className={ACCENT} />
      <text x="186" y="68" textAnchor="middle" className={LABEL}>Remote</text>
    </Scene>
  );
}
