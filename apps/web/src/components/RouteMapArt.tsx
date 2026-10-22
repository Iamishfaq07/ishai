import { cx } from "@orbit/ui";

/**
 * The Route map's own picture: contour lines like a trail map, and a route drawn across them through four stops to a
 * flag. Decorative (the words beside it carry the meaning), drawn in the ink and accent tokens so both themes work, and
 * the route draws itself in once on Full motion (base.css `.route-draw`). `stops` lights that many stops, so the
 * picture can echo how far a search has come; omit it for a plain illustration.
 */
export function RouteMapArt({ stops = 4, className }: { stops?: number; className?: string }) {
  const points: [number, number][] = [[38, 168], [118, 128], [196, 142], [262, 70]];
  return (
    <svg viewBox="0 0 320 200" aria-hidden focusable="false" className={cx("text-zinc-300 dark:text-zinc-700", className)}>
      <g fill="none" stroke="currentColor" strokeWidth="1" opacity="0.9">
        <path d="M-10 182c46-20 84-12 118-30s58-52 104-50 66 30 118 14" />
        <path d="M-10 154c40-14 74-6 104-26s54-58 98-58 70 26 138 6" />
        <path d="M-10 124c36-10 62-4 90-22s48-62 92-64 74 18 158-4" />
        <path d="M30 210c20-24 54-34 92-30s70-10 92-40 56-38 116-30" />
        <ellipse cx="248" cy="70" rx="44" ry="26" />
        <ellipse cx="248" cy="70" rx="24" ry="13" />
      </g>
      <path
        className="route-draw text-indigo-600 dark:text-indigo-400"
        style={{ ["--len" as string]: "420" }}
        d="M38 168C70 158 92 132 118 128s52 18 78 14 44-52 66-72"
        fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 9"
      />
      {points.map(([x, y], i) => {
        const reached = i < stops - 1, next = i === stops - 1;
        return (
          <g key={i} className="route-stop" style={{ ["--i" as string]: i + 2, transformOrigin: `${x}px ${y}px` }}>
            <circle cx={x} cy={y} r={next ? 9 : 7}
              className={reached ? "fill-indigo-600 dark:fill-indigo-400" : next ? "fill-white stroke-indigo-600 dark:fill-zinc-900 dark:stroke-indigo-400" : "fill-white stroke-zinc-300 dark:fill-zinc-900 dark:stroke-zinc-600"}
              strokeWidth={next ? 3 : 1.5} />
          </g>
        );
      })}
      <g className="route-stop" style={{ ["--i" as string]: 6, transformOrigin: "262px 70px" }}>
        <path d="M262 62V30" className="stroke-zinc-500 dark:stroke-zinc-400" strokeWidth="2" strokeLinecap="round" />
        <path d="M263 31h22l-6 8 6 8h-22z" className="fill-indigo-600 dark:fill-indigo-400" />
      </g>
    </svg>
  );
}
