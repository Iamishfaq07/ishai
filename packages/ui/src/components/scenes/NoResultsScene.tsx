import { ACCENT, LINE, PAPER, SPARK, Scene, Stars, type SceneProps } from "./parts";

/** No results: a telescope trained on a patch of sky with nothing in it yet. */
export function NoResultsScene(props: SceneProps) {
  return (
    <Scene {...props}>
      <Stars at={[[24, 30, 1], [64, 16, 0.8], [130, 24, 1.2], [226, 76, 1], [214, 132, 0.8], [36, 110, 0.8], [108, 52, 0.8]]} />
      {/* Where it is looking: empty. */}
      <circle cx="184" cy="42" r="20" className={ACCENT} strokeOpacity="0.55" strokeDasharray="3 4" />
      <path d="M184 30v4M184 50v4M172 42h4M192 42h4" className={ACCENT} strokeOpacity="0.55" />
      <path d={SPARK(220, 24, 4)} className="fill-aurora-400 motion-ok:animate-twinkle" />
      {/* The telescope on its tripod. */}
      <path d="M96 98 76 138M96 98v42M96 98l22 40M66 140h62" className={LINE} strokeWidth="1.5" />
      <g transform="rotate(-27 98 90)">
        <rect x="62" y="82" width="74" height="17" rx="5" className={PAPER} />
        <rect x="134" y="78" width="12" height="25" rx="3" className={`${PAPER} ${ACCENT}`} strokeWidth="1.5" />
        <rect x="52" y="85.5" width="11" height="10" rx="2.5" className={PAPER} />
        <path d="M84 82v17M112 82v17" className={LINE} />
      </g>
      <circle cx="96" cy="98" r="3.5" className="fill-zinc-400 dark:fill-zinc-500" />
    </Scene>
  );
}
