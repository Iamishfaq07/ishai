import { cx, focusRing } from "@orbit/ui";
import { DESKTOP_DOWNLOAD_URL, MS_STORE_LIVE, MS_STORE_URL } from "../lib/desktop";

/**
 * The Microsoft Store badge ("Download from the Microsoft Store"): the Windows download once Orbit's listing is
 * public (MS_STORE_LIVE: VITE_MS_STORE_LIVE=true, off until certification passes, docs/MICROSOFT_STORE.md). Until
 * then it renders nothing and the pages keep their installer links as they are.
 *
 * The artwork is Microsoft's own badge, unmodified, from its badge generator (https://apps.microsoft.com/badge, the
 * static image in https://github.com/microsoft/app-store-badge: get.microsoft.com/images/en-us dark.svg and light.svg),
 * served from public/badges because the site's CSP allows images from itself only. The link uses the generator's
 * "Direct" launch mode: Microsoft's web installer for free packaged apps.
 */
export function StoreBadge({ className, installerLink = true, onDark = false }: { className?: string; installerLink?: boolean; onDark?: boolean }) {
  if (!MS_STORE_LIVE) return null;
  return (
    <div className={cx("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      <a href={MS_STORE_URL} aria-label="Download from the Microsoft Store" className={cx("inline-flex rounded-md", focusRing)}>
        {/* Microsoft's "dark" badge is for light backgrounds, its "light" one for dark backgrounds (and always on a dark card). */}
        {!onDark && <img src="/badges/microsoft-store-en-us-dark.svg" alt="" width={161} height={44} className="h-11 w-auto dark:hidden" />}
        <img src="/badges/microsoft-store-en-us-light.svg" alt="" width={161} height={44} className={cx("h-11 w-auto", !onDark && "hidden dark:block")} />
      </a>
      {installerLink && (
        <a href={DESKTOP_DOWNLOAD_URL} className={cx("rounded text-sm font-medium underline underline-offset-2", focusRing)}>
          Or download the installer
        </a>
      )}
    </div>
  );
}
