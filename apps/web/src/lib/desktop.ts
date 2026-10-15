/** The web app captures a shared browser tab; the desktop app captures whole-system and per-app audio. The latest
 * installer, from the free public download site (scripts/publish-download.ps1): GitHub release downloads need a
 * GitHub sign-in while the repo is private. */
export const DESKTOP_DOWNLOAD_URL: string =
  import.meta.env.VITE_DESKTOP_DOWNLOAD_URL ?? "https://orbit-downloads.ishfaq.workers.dev/Orbit-Setup.exe";

/** The installer isn't Authenticode-signed yet, so Windows SmartScreen warns on first run: the app is labelled Beta
 * until it is (docs/WINDOWS_RELEASE.md). Set VITE_DESKTOP_SIGNED=true once signed builds are published. */
export const DESKTOP_BETA: boolean = import.meta.env.VITE_DESKTOP_SIGNED !== "true";
export const DESKTOP_BETA_NOTE =
  "Beta: the installer isn't code-signed yet, so Windows may show \"Windows protected your PC\". Choose More info → Run anyway, or keep using the web app.";
