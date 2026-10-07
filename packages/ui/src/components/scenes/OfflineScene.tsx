import { ACCENT, LINE, PAPER, Scene, Stars, type SceneProps } from "./parts";

/** Offline: a dish reaching for a satellite, the signal breaking off halfway. */
export function OfflineScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[22, 24, 1], [70, 14, 0.8], [228, 96, 1], [150, 132, 0.8], [124, 26, 1], [30, 92, 0.8]]} />
      {/* The satellite, far off. */}
      <g transform="rotate(-20 196 38)">
        <rect x="190" y="32" width="12" height="12" rx="2" className={PAPER} />
        <rect x="170" y="35" width="17" height="6" rx="1" className={`${PAPER} stroke-aurora-400`} />
        <rect x="205" y="35" width="17" height="6" rx="1" className={`${PAPER} stroke-aurora-400`} />
      </g>
      {/* The signal: it starts out, then gaps and fades. */}
      <path d="M107 72 128 60" className={ACCENT} strokeWidth="1.5" />
      <path d="M137 55 147 49M157 44l3-1.5" className={ACCENT} strokeOpacity="0.4" strokeWidth="1.5" />
      <path d="M114 55q7 4 6 12M120 47q13 7 10 22" className={ACCENT} strokeOpacity="0.5" />
      {/* The dish: bowl, rim, the arms to its feed, on a stand. */}
      <path d="M86 100v24M70 126h36" className={LINE} strokeWidth="1.5" />
      <rect x="78" y="120" width="20" height="8" rx="2" className={PAPER} />
      <path d="M72 58.6Q48 102 104 109.4" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
      <ellipse cx="88" cy="84" rx="30" ry="9" transform="rotate(58 88 84)" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
      <path d="M72 58.6 106.7 72.3 104 109.4" className={ACCENT} strokeOpacity="0.6" />
      <circle cx="106.7" cy="72.3" r="3" className="fill-indigo-500 dark:fill-indigo-400" />
    </Scene>
  );
}
