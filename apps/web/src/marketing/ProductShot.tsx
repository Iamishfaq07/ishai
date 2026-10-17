import { useSyncExternalStore } from "react";
import { cx } from "@orbit/ui";

/**
 * A real screen of the app, captured from a local stack with demo data (marketing/screens/: seed + capture scripts),
 * as WebP in both themes (`shots/<name>-light.webp`, `-dark.webp`, 1600 x 1000). Only the current theme's file is
 * fetched, lazily, with its size reserved so nothing moves when it arrives. A missing file (a fresh checkout before
 * the screens are captured) leaves a quiet placeholder of the same size instead of breaking the build.
 */
const SHOTS = import.meta.glob<string>("./shots/*.webp", { eager: true, query: "?url", import: "default" });

export type ShotName = "copilot" | "practice" | "resume" | "jobs" | "mission";

function subscribe(onChange: () => void): () => void {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}
const isDark = () => document.documentElement.classList.contains("dark");

/** Whether the page is in dark mode now (html.dark, set by theme-init.js and Settings), following changes. */
export function useDarkTheme(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => false);
}

export function shotUrl(name: ShotName, dark: boolean): string | null {
  return SHOTS[`./shots/${name}-${dark ? "dark" : "light"}.webp`] ?? SHOTS[`./shots/${name}-light.webp`] ?? null;
}

export function ProductShot({
  name,
  alt,
  className,
  priority = false,
}: {
  name: ShotName;
  /** What the screen shows, for screen readers ("Jobs AI's matches: ..."). */
  alt: string;
  className?: string;
  /** Above the fold: load at once instead of lazily. */
  priority?: boolean;
}) {
  const dark = useDarkTheme();
  const src = shotUrl(name, dark);
  return (
    <div className={cx("mk-float overflow-hidden rounded-xl mk-surface", className)}>
      {src ? (
        <img
          src={src}
          alt={alt}
          width={1600}
          height={1000}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className="block h-auto w-full"
        />
      ) : (
        <div role="img" aria-label={alt} className="aspect-[16/10] w-full mk-band" />
      )}
    </div>
  );
}
