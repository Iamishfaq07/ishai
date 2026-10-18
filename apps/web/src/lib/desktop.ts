/** The web app captures a shared browser tab; the desktop app captures whole-system and per-app audio. The latest
 * installer, from the free public download site (scripts/publish-download.ps1): GitHub release downloads need a
 * GitHub sign-in while the repo is private. */
export const DESKTOP_DOWNLOAD_URL: string =
  import.meta.env.VITE_DESKTOP_DOWNLOAD_URL ?? "https://orbit-downloads.ishfaq.workers.dev/Orbit-Setup.exe";

/** The installer isn't Authenticode-signed yet, so Windows SmartScreen warns on first run: the app is labelled Beta
 * until it is (docs/WINDOWS_RELEASE.md). Set VITE_DESKTOP_SIGNED=true once signed builds are published. */
export const DESKTOP_BETA: boolean = import.meta.env.VITE_DESKTOP_SIGNED !== "true";

/** Orbit on the Microsoft Store (Partner Center > Product identity > Store ID). Microsoft signs the Store copy. */
export const MS_STORE_ID = "9NJ1ZXGTCZKL";
/** `mode=direct`: the badge's "Direct" launch mode, Microsoft's web installer for free packaged apps. */
export const MS_STORE_URL = `https://apps.microsoft.com/detail/${MS_STORE_ID}?mode=direct`;
/** Off until certification passes and the listing is public (docs/MICROSOFT_STORE.md): set VITE_MS_STORE_LIVE=true. */
export const MS_STORE_LIVE: boolean = import.meta.env.VITE_MS_STORE_LIVE === "true";

export const DESKTOP_BETA_NOTE =
  "Beta: the installer isn't code-signed yet, so Windows may show \"Windows protected your PC\". Choose More info → Run anyway, or keep using the web app.";
