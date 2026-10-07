import { ACCENT, ACCENT_SOFT, BAR, LABEL, LINE, Scene, type SceneProps } from "./parts";

const COLUMNS = ["Saved", "Applied", "Interviewing"];

/** The tracker before its first job: three ghost columns, one card each, and the way a job moves along. */
export function TrackerScene(props: SceneProps) {
  return (
    <Scene {...props}>
      {COLUMNS.map((name, i) => {
        const x = 10 + i * 76;
        const last = i === COLUMNS.length - 1;
        return (
          <g key={name}>
            <rect x={x} y="22" width="68" height="116" rx="9" className="fill-zinc-500/5 dark:fill-white/[0.04]" />
            <text x={x + 9} y="38" className={LABEL}>
              {name}
            </text>
            <g className={last ? "motion-ok:animate-float" : undefined}>
              <rect
                x={x + 7}
                y="48"
                width="54"
                height="34"
                rx="6"
                strokeDasharray={last ? undefined : "3 3"}
                className={last ? `${ACCENT_SOFT} ${ACCENT}` : `fill-white/40 dark:fill-white/[0.02] ${LINE}`}
                strokeWidth={last ? 1.5 : 1}
              />
              <rect x={x + 14} y="57" width="26" height="3.5" rx="1.75" className={last ? "fill-indigo-500/60 dark:fill-indigo-400/60" : BAR} />
              <rect x={x + 14} y="65" width="34" height="2.5" rx="1.25" className={BAR} />
              <rect x={x + 14} y="71" width="18" height="2.5" rx="1.25" className={BAR} />
            </g>
          </g>
        );
      })}
      {/* Along: saved, then applied, then interviewing. */}
      <path d="M56 96c14 12 32 12 46 0M132 96c14 12 32 12 46 0" className={ACCENT} strokeOpacity="0.6" strokeDasharray="2 4" />
      <path d="M98 99.5l4-3.5.8 5.2M174 99.5l4-3.5.8 5.2" className={ACCENT} strokeOpacity="0.6" />
    </Scene>
  );
}
