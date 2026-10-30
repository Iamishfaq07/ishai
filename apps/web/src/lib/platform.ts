// Which device and system the browser runs on: on its own so the app shell can ask without loading audio capture.

/** A phone or tablet. Mobile browsers may expose getDisplayMedia (Android Chrome does) but can't share a tab's audio. */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData?.mobile) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || isIpadOs();
}

/** iPadOS reports itself as a Mac; touch points give it away. */
function isIpadOs(): boolean {
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

export function isAppleMobile(): boolean {
  return typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || isIpadOs());
}

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent) && !isIpadOs();
}

export function isWindows(): boolean {
  return typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);
}
