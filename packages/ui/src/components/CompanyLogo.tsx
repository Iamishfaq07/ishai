import { useState } from "react";
import { cx } from "./cx";

// Gradient pairs dark enough for white letters to pass WCAG AA on either end (all -600/-700 steps).
const GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ["#4f46e5", "#0369a1"], // indigo → sky
  ["#0f766e", "#047857"], // teal → emerald
  ["#7c3aed", "#4f46e5"], // violet → indigo
  ["#be123c", "#9333ea"], // rose → purple
  ["#b45309", "#be123c"], // amber → rose
  ["#0369a1", "#0f766e"], // sky → teal
  ["#a21caf", "#be123c"], // fuchsia → rose
  ["#4338ca", "#7e22ce"], // indigo → purple
];

const SIZES = { xs: 16, sm: 24, md: 32, lg: 40 } as const;

/** Up to two letters for a company ("Tata Consultancy" → "TC", "stripe" → "S") and its gradient, both stable per name. */
export function monogram(company: string): { letters: string; from: string; to: string } {
  const name = company.trim();
  const words = name.split(/[\s\-_.&/]+/u).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const first = (w: string | undefined) => w?.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? "";
  const letters = (first(words[0]) + (words.length > 1 ? first(words[1]) : "")) || "?";
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [from, to] = GRADIENTS[hash % GRADIENTS.length]!;
  return { letters, from, to };
}

/**
 * A company's logo when there's a URL that loads, else a monogram on a gradient picked from the name. A real logo sits
 * on a white backing pill so a dark logo stays visible on the dark theme. Decorative: the name is always shown beside.
 */
export function CompanyLogo({
  company,
  logoUrl,
  size = "md",
  className,
}: {
  company: string;
  logoUrl?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const px = SIZES[size];
  const radius = size === "xs" ? "rounded" : "rounded-lg";
  if (logoUrl && failed !== logoUrl) {
    return (
      <span
        aria-hidden="true"
        className={cx("flex shrink-0 items-center justify-center overflow-hidden bg-white ring-1 ring-zinc-900/10 dark:ring-white/15", radius, className)}
        style={{ width: px, height: px, padding: Math.round(px / 8) }}
      >
        <img src={logoUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" onError={() => setFailed(logoUrl)} />
      </span>
    );
  }
  const { letters, from, to } = monogram(company);
  const id = `mg-${letters}-${from.slice(1)}-${to.slice(1)}`;
  return (
    <svg aria-hidden="true" width={px} height={px} viewBox="0 0 40 40" className={cx("shrink-0", radius, className)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx={size === "xs" ? 8 : 10} fill={`url(#${id})`} />
      <text
        x="20"
        y="20"
        dy="0.35em"
        textAnchor="middle"
        fill="#ffffff"
        fontFamily="inherit"
        fontWeight="600"
        fontSize={letters.length > 1 ? 16 : 19}
      >
        {letters}
      </text>
    </svg>
  );
}
