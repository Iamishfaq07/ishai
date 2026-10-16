// On first install, open Orbit's "Connect the extension" page, so the person can sign in straight away.
declare const __ORBIT_WEB_URL__: string;

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void chrome.tabs.create({ url: `${__ORBIT_WEB_URL__}/extension/connect` });
});
