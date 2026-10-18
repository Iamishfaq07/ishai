// The service worker. On first install, open Orbit's "Connect the extension" page, so the person can sign in straight
// away. It also runs auto-apply (lib/autoApply/runner.ts), only while the candidate has it turned on.
import { ALARM, dismiss, handoff, tick, updateBadge } from "./lib/autoApply/runner";
import { KEYS, setSettings, type AutoApplyMessage } from "./lib/autoApply/state";

declare const __ORBIT_WEB_URL__: string;

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void chrome.tabs.create({ url: `${__ORBIT_WEB_URL__}/extension/connect` });
  void tick();
});
chrome.runtime.onStartup.addListener(() => void tick());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void tick();
});

// Turned on, off, paused or resumed in the popup.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && KEYS.settings in changes) void tick();
});

// The ATS sites taken away in the browser's settings: auto-apply is off.
chrome.permissions.onRemoved.addListener(() => void setSettings({ enabled: false }).then(() => tick()));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only the extension's own pages (the popup, also when opened in a tab) talk to the runner; never a web page.
  if (sender.id !== chrome.runtime.id || !(sender.url ?? "").startsWith(chrome.runtime.getURL(""))) return;
  const m = message as AutoApplyMessage;
  if (m?.type === "autoApply:handoff") {
    void handoff(m.id).then(sendResponse, () => sendResponse(false));
    return true;
  }
  if (m?.type === "autoApply:dismiss") {
    void dismiss(m.id).then(() => sendResponse(true));
    return true;
  }
  if (m?.type === "autoApply:refresh" || m?.type === "autoApply:changed") {
    // Answered at once: an application takes minutes, and holding the message open would keep this event (and the
    // service worker) pinned to it. The run keeps itself alive (runner.ts), and the popup reads the result from storage.
    void tick();
    sendResponse(true);
    return;
  }
  return;
});

void updateBadge();
