/** The web app captures a shared browser tab; the desktop app captures whole-system and per-app audio. The latest
 * installer, from the free public download site (scripts/publish-download.ps1): GitHub release downloads need a
 * GitHub sign-in while the repo is private. */
export const DESKTOP_DOWNLOAD_URL: string =
  import.meta.env.VITE_DESKTOP_DOWNLOAD_URL ?? "https://orbit-downloads.ishfaq.workers.dev/Orbit-Setup.exe";
