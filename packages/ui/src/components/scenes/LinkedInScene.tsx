import { ACCENT, ACCENT_SOFT, BAR, DRAW, IN, LINE, NUDGE, PAPER, POP, Person, Scene, Stars, Tick, at, type SceneProps } from "./parts";

/** LinkedIn AI: your profile card, its headline being rewritten, and the recruiter's search that now finds it. */
export function LinkedInScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[18, 24, 1], [226, 20, 0.8], [216, 144, 1], [24, 140, 0.8], [124, 12, 0.8]]} />
      {/* The profile: a banner, the person, a name, the headline (the subject), the About and three skills. */}
      <g className={IN}>
        <rect x="22" y="22" width="120" height="116" rx="9" className={PAPER} />
        <path d="M22 50h120" className={LINE} />
        <rect x="34" y="74" width="40" height="4.5" rx="2.25" className={BAR} />
        <rect x="34" y="104" width="86" height="3" rx="1.5" className={BAR} />
        <rect x="34" y="111" width="70" height="3" rx="1.5" className={BAR} />
        <rect x="34" y="122" width="20" height="7" rx="3.5" className={PAPER} />
        <rect x="58" y="122" width="26" height="7" rx="3.5" className={PAPER} />
        <rect x="88" y="122" width="16" height="7" rx="3.5" className={PAPER} />
      </g>
      <g className={POP} style={at(150)}>
        <Person x={50} y={50} r={14} accent />
      </g>
      <rect x="30" y="83" width="90" height="12" rx="4" className={`${ACCENT_SOFT} ${ACCENT}`} />
      <path d="M36 89h62" pathLength={1} className={`${ACCENT} ${DRAW}`} strokeWidth="3" strokeOpacity="0.6" style={at(300)} />
      {/* Found: the search lens over the headline's words. */}
      <path d="M124 89c18 0 26-14 38-18" className={ACCENT} strokeOpacity="0.6" strokeDasharray="2 4" />
      <g className={NUDGE}>
        <g className={IN} style={at(450, { x: 10, y: 0 })}>
          <path d="M200 92l18 18" className={LINE} strokeWidth="4" />
          <circle cx="184" cy="74" r="24" className={PAPER} strokeWidth="1.5" />
          <rect x="170" y="68" width="28" height="4.5" rx="2.25" className="fill-indigo-500/60 dark:fill-indigo-400/60" />
          <rect x="170" y="77" width="20" height="3" rx="1.5" className={BAR} />
          <Tick x={204} y={54} r={7} delay={750} solid />
        </g>
      </g>
    </Scene>
  );
}
