import { cx } from "@orbit/ui";

/**
 * A real screen of the app, captured from a local stack with demo data (marketing/screens/: seed + capture scripts),
 * as WebP in both themes (`shots/<name>-light.webp`, `-dark.webp`, 1600 x 1000), and for phones a 4:3 crop of the
 * screen's working area (`-phone.webp`, 1200 x 900) so it stays legible on a small screen.
 *
 * Plain markup, no JavaScript decides anything: the light and the dark picture are both in the page, the one for the
 * other theme hidden by CSS (`dark:`), and both are lazy, so the browser only ever fetches the one it shows, at the
 * width it's shown. That's also what the built HTML of a public page carries (src/prerender), with every size
 * reserved, so nothing moves when a picture arrives. A missing file (a fresh checkout before the screens are captured)
 * leaves a quiet placeholder of the same size instead of breaking the build.
 */
const SHOTS = import.meta.glob<string>("./shots/*.webp", { eager: true, query: "?url", import: "default" });

export type ShotName = "copilot" | "practice" | "resume" | "jobs" | "mission";

export function shotUrl(name: ShotName, dark: boolean, phone = false): string | null {
  const suffix = phone ? "-phone" : "";
  return SHOTS[`./shots/${name}-${dark ? "dark" : "light"}${suffix}.webp`] ?? SHOTS[`./shots/${name}-light${suffix}.webp`] ?? null;
}

function Picture({ name, dark, alt, priority, className }: { name: ShotName; dark: boolean; alt: string; priority: boolean; className: string }) {
  const src = shotUrl(name, dark);
  const phone = shotUrl(name, dark, true);
  if (!src) return null;
  return (
    <picture className={className}>
      {phone && <source media="(max-width: 639px)" srcSet={phone} width={1200} height={900} />}
      <img src={src} alt={alt} width={1600} height={1000} loading={priority ? "eager" : "lazy"} decoding="async" className="block h-auto w-full" />
    </picture>
  );
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
  /** Above the fold: load at once instead of lazily (only the light picture is then eager). */
  priority?: boolean;
}) {
  const light = shotUrl(name, false);
  return (
    <div className={cx("mk-float overflow-hidden rounded-xl mk-surface", className)}>
      {light ? (
        <>
          <Picture name={name} dark={false} alt={alt} priority={priority} className="block dark:hidden" />
          <Picture name={name} dark alt={alt} priority={false} className="hidden dark:block" />
        </>
      ) : (
        <div role="img" aria-label={alt} className="aspect-[16/10] w-full mk-band" />
      )}
    </div>
  );
}
