import { ACCENT, ACCENT_SOFT, LABEL, LINE, PAPER, POP, SPARK, Scene, Stars, at, pin, type SceneProps } from "./parts";

/** Welcome: Orbit as a planet, with a moon for each product on one orbit: interview, resume, jobs. */
export function WelcomeScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[18, 30, 1.2], [60, 18, 0.8], [212, 22, 1], [226, 128, 1.2], [92, 146, 0.8], [150, 16, 0.8]]} />
      <ellipse cx="120" cy="86" rx="100" ry="30" transform="rotate(-8 120 86)" className={LINE} strokeDasharray="2 5" />
      <g className="motion-ok:animate-float">
        {/* The ring's far side, the planet, then the ring's near side across it. */}
        <path d="M76 84a46 11 -8 0 1 89-13" className={ACCENT} strokeOpacity="0.35" strokeWidth="1.5" />
        <circle cx="120" cy="80" r="30" className="fill-white dark:fill-zinc-900" />
        <circle cx="120" cy="80" r="30" className={`${ACCENT_SOFT} ${ACCENT}`} strokeWidth="1.5" />
        <path d="M96 70c14 6 34 6 48-2M93 86c16 7 38 6 54-3" className={ACCENT} strokeOpacity="0.4" />
        <path d="M76 84a46 11 -8 0 0 89-13" className={ACCENT} strokeWidth="1.5" />
        <path d={SPARK(153, 46, 4.5)} className="fill-aurora-400 motion-ok:animate-twinkle" />
      </g>
      {/* Interview: a microphone. */}
      <g className={POP} style={at(200)}>
        <circle cx="25.5" cy="88.9" r="13" className={PAPER} />
        <rect x="22.5" y="81" width="6" height="10" rx="3" className={ACCENT} strokeWidth="1.5" />
        <path d="M19.5 88a6 6 0 0 0 12 0M25.5 94v3" className={ACCENT} strokeWidth="1.5" />
        <text x="25.5" y="115" textAnchor="middle" className={LABEL}>Interview</text>
      </g>
      {/* Resume: a page. */}
      <g className={POP} style={at(350)}>
        <circle cx="193.2" cy="56.2" r="13" className={PAPER} />
        <rect x="188" y="49" width="10.5" height="14" rx="1.5" className={ACCENT} strokeWidth="1.5" />
        <path d="M190.5 53.5h5.5M190.5 57h5.5M190.5 60.5h3.5" className={ACCENT} />
        <text x="193.2" y="35" textAnchor="middle" className={LABEL}>Resume</text>
      </g>
      {/* Jobs: a pin. */}
      <g className={POP} style={at(500)}>
        <circle cx="173.1" cy="104.8" r="13" className={PAPER} />
        <path d={pin(173.1, 112, 4.6)} className={ACCENT} strokeWidth="1.5" />
        <circle cx="173.1" cy="104.2" r="1.6" className="fill-indigo-500 dark:fill-indigo-400" />
        <text x="173.1" y="131" textAnchor="middle" className={LABEL}>Jobs</text>
      </g>
    </Scene>
  );
}
