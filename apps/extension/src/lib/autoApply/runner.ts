// The auto-apply runner, in the service worker. While the candidate has it on (and the browser is open), it asks
// Orbit for the next application on a chrome.alarms schedule, opens it in a visible "Orbit Apply" window (a labelled
// tab group, with the toolbar badge showing it's applying), fills it through the ATS adapter, presses the form's own
// submit button only when everything is filled and the page shows no errors, waits for the ATS's success state, and
// reports back with proof. One application at a time; anything Orbit can't do becomes "Needs you".
import { ATS_ORIGINS, onAtsHost } from "./adapters";
import { MAX_SCREENSHOT_B64, type ApplicationPacket, type ApplyResult, type ApplyStatus } from "./contract";
import type { PageCheck, ResumeFile, RunOutcome } from "./engine";
import { verdict } from "./engine";
import { nextDelay, MIN_DELAY, type Moment } from "./schedule";
import { getHandoffs, getHistory, getSettings, HISTORY_MAX, KEYS, setSettings, type CurrentRun, type Handoff, type HistoryItem } from "./state";

declare const __ORBIT_API_URL__: string;
declare const __ORBIT_APPLY_PACE__: number;
const API = __ORBIT_API_URL__;
const PACE = typeof __ORBIT_APPLY_PACE__ === "number" ? __ORBIT_APPLY_PACE__ : 1;
export const ALARM = "orbit-auto-apply";
const LOAD_TIMEOUT = 45_000;
const FILL_TIMEOUT = 8 * 60_000;
const CONFIRM_TIMEOUT = 60_000;
const MAX_RESUME = 10 * 1024 * 1024;

type PageApi = {
  start: (ats: string, packet: ApplicationPacket, resume: ResumeFile | null) => boolean;
  poll: () => { done: boolean; outcome: RunOutcome | null; error: string | null } | null;
  submit: (ats: string) => boolean;
  check: (ats: string) => PageCheck;
  prepare: (ats: string, packet: ApplicationPacket, resume: ResumeFile | null, reason: string | null) => Promise<RunOutcome>;
};

let running = false;
/** Why the last application ended as it did (kept with its history item, for the popup and for support). */
let lastDetail = "";

// ---- Orbit API ----------------------------------------------------------------------------------------------------

class SignedOut extends Error {}

async function token(): Promise<string | null> {
  const { token: t } = await chrome.storage.local.get(["token"]);
  return typeof t === "string" ? t : null;
}

async function orbit(path: string, init: RequestInit = {}): Promise<Response> {
  const t = await token();
  if (!t) throw new SignedOut("Not connected to Orbit.");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 401) throw new SignedOut("Orbit sign-in expired.");
  return res;
}

async function getStatus(): Promise<ApplyStatus> {
  const res = await orbit("/v1/apply/status");
  if (!res.ok) throw new Error(`status ${res.status}`);
  const status = (await res.json()) as ApplyStatus;
  await chrome.storage.local.set({ [KEYS.status]: { ...status, fetchedAt: Date.now() } });
  return status;
}

async function postResult(id: string, result: ApplyResult): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await orbit(`/v1/apply/${encodeURIComponent(id)}/result`, { method: "POST", body: JSON.stringify(result) });
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) return res.ok;
    } catch (e) {
      if (e instanceof SignedOut) break;
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  // Kept and sent again next time, so a result is never lost.
  const { [KEYS.outbox]: box } = await chrome.storage.local.get([KEYS.outbox]);
  const outbox = (Array.isArray(box) ? box : []) as { id: string; result: ApplyResult }[];
  outbox.push({ id, result });
  await chrome.storage.local.set({ [KEYS.outbox]: outbox.slice(-10) });
  return false;
}

async function flushOutbox(): Promise<void> {
  const { [KEYS.outbox]: box } = await chrome.storage.local.get([KEYS.outbox]);
  const outbox = (Array.isArray(box) ? box : []) as { id: string; result: ApplyResult }[];
  if (!outbox.length) return;
  await chrome.storage.local.set({ [KEYS.outbox]: [] });
  for (const item of outbox) await postResult(item.id, item.result);
}

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function fetchResume(packet: ApplicationPacket): Promise<ResumeFile | null> {
  try {
    const url = new URL(packet.resume.download_url, API);
    const sameApi = url.origin === new URL(API).origin;
    const t = await token();
    const res = await fetch(url.href, sameApi && t ? { headers: { Authorization: `Bearer ${t}` } } : {});
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_RESUME) return null;
    const type = res.headers.get("content-type")?.split(";")[0] || (/\.pdf$/i.test(packet.resume.filename) ? "application/pdf" : "application/octet-stream");
    return { b64: base64(buf), filename: packet.resume.filename || "Resume.pdf", type };
  } catch {
    return null;
  }
}

// ---- Badge, schedule ----------------------------------------------------------------------------------------------

export async function updateBadge(): Promise<void> {
  const { [KEYS.current]: cur } = await chrome.storage.local.get([KEYS.current]);
  const current = cur as CurrentRun | undefined;
  if (current) {
    await chrome.action.setBadgeBackgroundColor({ color: "#7c3aed" });
    await chrome.action.setBadgeText({ text: "▶" });
    await chrome.action.setTitle({ title: `Orbit is applying: ${current.title} at ${current.company} (see the "Orbit Apply" window)` });
    return;
  }
  const waiting = (await getHistory()).filter((h) => h.status === "needs_you" && !h.handled).length;
  const settings = await getSettings();
  await chrome.action.setBadgeBackgroundColor({ color: "#b45309" });
  await chrome.action.setBadgeText({ text: waiting ? String(Math.min(waiting, 99)) : "" });
  await chrome.action.setTitle({
    title: waiting ? `Orbit: ${waiting} application${waiting === 1 ? "" : "s"} need you` : settings.enabled ? (settings.paused ? "Orbit (auto-apply paused)" : "Orbit (auto-apply on)") : "Orbit",
  });
}

async function schedule(m: Moment): Promise<void> {
  const delay = Math.max(MIN_DELAY, nextDelay(m, Date.now()));
  await chrome.alarms.create(ALARM, { when: Date.now() + delay });
}

async function failures(reset = false): Promise<number> {
  if (reset) {
    await chrome.storage.local.set({ [KEYS.backoff]: 0 });
    return 0;
  }
  const { [KEYS.backoff]: n } = await chrome.storage.local.get([KEYS.backoff]);
  const next = (typeof n === "number" ? n : 0) + 1;
  await chrome.storage.local.set({ [KEYS.backoff]: next });
  return next;
}

async function addHistory(packet: ApplicationPacket, result: ApplyResult): Promise<void> {
  const item: HistoryItem = {
    id: packet.id,
    company: packet.job.company,
    title: packet.job.title,
    url: packet.job.url || packet.job.apply_url,
    ats: packet.job.ats,
    status: result.status,
    reason: result.reason,
    unknown: result.unknown_questions,
    finalUrl: result.final_url,
    at: Date.now(),
    detail: lastDetail || undefined,
  };
  const history = [item, ...(await getHistory()).filter((h) => h.id !== packet.id)].slice(0, HISTORY_MAX);
  const handoffs = await getHandoffs();
  if (result.status === "needs_you") handoffs[packet.id] = { packet, reason: result.reason, savedAt: Date.now() };
  else delete handoffs[packet.id];
  await chrome.storage.local.set({ [KEYS.history]: history, [KEYS.handoffs]: handoffs });
}

// ---- Tabs ---------------------------------------------------------------------------------------------------------

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForLoad(tabId: number, timeout: number): Promise<boolean> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return false;
    if (tab.status === "complete") return true;
    await wait(300);
  }
  return false;
}

async function inPage<R>(tabId: number, method: keyof PageApi, args: unknown[]): Promise<R> {
  const has = await chrome.scripting.executeScript({
    target: { tabId },
    func: (() => !!(globalThis as unknown as { __orbitApply?: unknown }).__orbitApply) as (...a: never[]) => boolean,
  });
  if (!has[0]?.result) await chrome.scripting.executeScript({ target: { tabId }, files: ["apply.js"] });
  const [out] = await chrome.scripting.executeScript({
    target: { tabId },
    func: ((m: string, a: unknown[]) => {
      const api = (globalThis as unknown as { __orbitApply: Record<string, (...x: unknown[]) => unknown> }).__orbitApply;
      return api[m]!(...a);
    }) as (...a: never[]) => R,
    args: [method, args],
  });
  return out?.result as R;
}

async function shrinkPng(dataUrl: string): Promise<string | null> {
  let b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  if (b64.length <= MAX_SCREENSHOT_B64) return b64;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    for (const scale of [0.75, 0.55, 0.4]) {
      const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      b64 = base64(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
      if (b64.length <= MAX_SCREENSHOT_B64) return b64;
    }
  } catch {
    /* fall through: no screenshot, the confirmation text stands */
  }
  return null;
}

async function screenshot(windowId: number): Promise<string | null> {
  try {
    return await shrinkPng(await chrome.tabs.captureVisibleTab(windowId, { format: "png" }));
  } catch {
    return null;
  }
}

function emptyResult(status: ApplyResult["status"], reason: ApplyResult["reason"]): ApplyResult {
  return { status, reason, unknown_questions: [], confirmation_text: null, final_url: null, screenshot_png_b64: null, submitted: { fields: {}, answers: [] } };
}

/** Opens the "Orbit Apply" window on the packet's form and runs it to a result. */
export async function applyPacket(packet: ApplicationPacket): Promise<ApplyResult | null> {
  lastDetail = "";
  if (!onAtsHost(packet.job.apply_url, packet.job.ats)) {
    lastDetail = "The application link isn't on a Greenhouse, Lever or Ashby page.";
    return emptyResult("skipped", "blocked");
  }
  if (Date.parse(packet.expires_at) <= Date.now()) return null;
  const resume = await fetchResume(packet);
  if (!resume) {
    lastDetail = "The resume couldn't be downloaded from Orbit.";
    return emptyResult("needs_you", "error");
  }

  const win = await chrome.windows.create({ url: packet.job.apply_url, focused: false, type: "normal", width: 1200, height: 900 });
  const tabId = win.tabs?.[0]?.id ?? null;
  const windowId = win.id ?? null;
  if (tabId === null || windowId === null) return emptyResult("failed", "error");
  try {
    const group = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId } });
    await chrome.tabGroups.update(group, { title: "Orbit Apply", color: "purple", collapsed: false });
  } catch {
    /* tab groups unavailable: the window is still Orbit's own and the badge says so */
  }
  const current: CurrentRun = { id: packet.id, company: packet.job.company, title: packet.job.title, tabId, windowId, startedAt: Date.now() };
  await chrome.storage.local.set({ [KEYS.current]: current });
  await updateBadge();
  let closedByPerson = false;
  const onRemoved = (id: number) => {
    if (id === tabId) closedByPerson = true;
  };
  chrome.tabs.onRemoved.addListener(onRemoved);
  // Extension API calls keep the service worker alive through a run that takes minutes.
  const keepAlive = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  const ats = packet.job.ats;
  try {
    if (!(await waitForLoad(tabId, LOAD_TIMEOUT))) return closedByPerson ? emptyResult("needs_you", "error") : emptyResult("failed", "error");
    const tab = await chrome.tabs.get(tabId);
    if (!onAtsHost(tab.url ?? "", ats)) {
      // Sent somewhere else (a sign-in page, a different site): never followed.
      return { ...emptyResult("needs_you", "login"), final_url: tab.url ?? null };
    }
    await inPage<boolean>(tabId, "start", [ats, packet, resume]);
    let outcome: RunOutcome | null = null;
    const fillEnd = Date.now() + FILL_TIMEOUT;
    while (!outcome) {
      if (closedByPerson) return emptyResult("needs_you", "error");
      if (Date.now() > fillEnd) return emptyResult("failed", "error");
      await wait(1500);
      const state = await inPage<ReturnType<PageApi["poll"]>>(tabId, "poll", []).catch(() => null);
      if (!state) {
        lastDetail = "The page went away while Orbit was filling it.";
        return emptyResult("failed", "form_changed");
      }
      if (state.done) {
        if (state.error || !state.outcome) {
          lastDetail = `Filling failed: ${state.error ?? "no outcome"}`;
          return emptyResult("failed", "error");
        }
        outcome = state.outcome;
      }
    }
    if (outcome.kind === "stop") {
      lastDetail = outcome.detail;
      return { ...emptyResult(outcome.status, outcome.reason), unknown_questions: outcome.unknown, submitted: outcome.submitted, final_url: (await chrome.tabs.get(tabId).catch(() => null))?.url ?? null };
    }
    const submitted = outcome.submitted;
    // The page may navigate as it submits: the click and the checks are separate calls.
    const pressed = await inPage<boolean>(tabId, "submit", [ats]).catch(() => true);
    if (!pressed) return { ...emptyResult("needs_you", "form_changed"), submitted };
    const started = Date.now();
    let errorSince: number | null = null;
    for (;;) {
      await wait(1000);
      if (closedByPerson) return { ...emptyResult("needs_you", "error"), submitted };
      const check = await inPage<PageCheck>(tabId, "check", [ats]).catch(() => null);
      const elapsed = Date.now() - started;
      if (check?.errors.length) errorSince ??= elapsed;
      else errorSince = null;
      const v = verdict(check, elapsed, CONFIRM_TIMEOUT, errorSince);
      if (!v.done) continue;
      lastDetail = v.status === "submitted" ? "The site showed its confirmation." : `After pressing submit: ${v.reason ?? v.status}${check?.errors.length ? ` (${check.errors.slice(0, 2).join(" / ")})` : ""}.`;
      const finalUrl = check?.url || (await chrome.tabs.get(tabId).catch(() => null))?.url || null;
      if (v.status === "submitted") {
        await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
        return { ...emptyResult("submitted", null), confirmation_text: v.confirmation, final_url: finalUrl, screenshot_png_b64: await screenshot(windowId), submitted };
      }
      return { ...emptyResult(v.status, v.reason), final_url: finalUrl, submitted };
    }
  } catch (e) {
    lastDetail = closedByPerson ? "The Orbit Apply window was closed." : `Error: ${e instanceof Error ? e.message : String(e)}`;
    return closedByPerson ? emptyResult("needs_you", "error") : emptyResult("failed", "error");
  } finally {
    clearInterval(keepAlive);
    chrome.tabs.onRemoved.removeListener(onRemoved);
    await chrome.windows.remove(windowId).catch(() => undefined);
    await chrome.storage.local.remove([KEYS.current]);
    await updateBadge();
  }
}

// ---- The loop -----------------------------------------------------------------------------------------------------

async function hostsGranted(): Promise<boolean> {
  return chrome.permissions.contains({ origins: ATS_ORIGINS }).catch(() => false);
}

/** A run the service worker was stopped in the middle of: close its window and report it. */
async function recoverStale(): Promise<void> {
  const { [KEYS.current]: cur } = await chrome.storage.local.get([KEYS.current]);
  const current = cur as CurrentRun | undefined;
  if (!current) return;
  if (current.windowId !== null) await chrome.windows.remove(current.windowId).catch(() => undefined);
  await chrome.storage.local.remove([KEYS.current]);
  await postResult(current.id, emptyResult("failed", "error"));
}


/** One turn of the loop: on the alarm, when turned on or resumed, and from the popup's "Check now". */
export async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await turn();
  } finally {
    running = false;
    await updateBadge();
  }
}

async function turn(): Promise<void> {
  const settings = await getSettings();
  if (!settings.enabled || settings.paused) {
    await chrome.alarms.clear(ALARM);
    return;
  }
  if (!(await hostsGranted())) {
    // The sites were taken away (chrome://extensions): auto-apply is off until turned on again.
    await setSettings({ enabled: false });
    await chrome.alarms.clear(ALARM);
    return;
  }
  const { [KEYS.nextAllowed]: nextAllowed } = await chrome.storage.local.get([KEYS.nextAllowed]);
  const nextAllowedAt = typeof nextAllowed === "number" ? nextAllowed : 0;
  if (Date.now() < nextAllowedAt) {
    await chrome.alarms.create(ALARM, { when: Math.max(nextAllowedAt, Date.now() + MIN_DELAY) });
    return;
  }
  try {
    await recoverStale();
    await flushOutbox();
    const status = await getStatus();
    if (status.paused) return await schedule({ kind: "paused", status });
    if (status.today >= status.limit) return await schedule({ kind: "limit", status });
    const res = await orbit("/v1/apply/next");
    if (res.status === 204) {
      await failures(true);
      return await schedule({ kind: "idle", status });
    }
    if (!res.ok) throw new Error(`next ${res.status}`);
    const packet = (await res.json()) as ApplicationPacket;
    const notBefore = Date.parse(packet.not_before);
    if (Number.isFinite(notBefore) && notBefore > Date.now() + 5_000) return await schedule({ kind: "not_before", at: notBefore });
    const result = await applyPacket(packet);
    if (result) {
      await addHistory(packet, result);
      await postResult(packet.id, result);
    }
    await failures(true);
    const gap = nextDelay({ kind: "after_apply" }, Date.now()) * PACE;
    await chrome.storage.local.set({ [KEYS.nextAllowed]: Date.now() + gap });
    await chrome.alarms.create(ALARM, { when: Date.now() + Math.max(gap, MIN_DELAY) });
    await chrome.storage.local.remove([KEYS.lastError]);
  } catch (e) {
    await chrome.storage.local.set({ [KEYS.lastError]: e instanceof Error ? e.message : String(e) });
    if (e instanceof SignedOut) {
      await chrome.alarms.clear(ALARM);
      return;
    }
    await schedule({ kind: "error", failures: await failures() });
  }
}

/** "Needs you": open the job in the candidate's own tab, fill what Orbit can, and leave the rest and the submit to
 * them. */
export async function handoff(id: string): Promise<boolean> {
  const handoffs = await getHandoffs();
  const item: Handoff | undefined = handoffs[id];
  const history = await getHistory();
  const entry = history.find((h) => h.id === id);
  const url = item?.packet.job.apply_url ?? entry?.url;
  if (!url) return false;
  const tab = await chrome.tabs.create({ url, active: true });
  await chrome.storage.local.set({ [KEYS.history]: history.map((h) => (h.id === id ? { ...h, handled: true } : h)) });
  await updateBadge();
  if (!item || tab.id === undefined || !onAtsHost(url, item.packet.job.ats) || !(await hostsGranted())) return true;
  if (!(await waitForLoad(tab.id, LOAD_TIMEOUT))) return true;
  const resume = await fetchResume(item.packet);
  await inPage(tab.id, "prepare", [item.packet.job.ats, item.packet, resume, item.reason]).catch(() => undefined);
  return true;
}

export async function dismiss(id: string): Promise<void> {
  const history = await getHistory();
  const handoffs = await getHandoffs();
  delete handoffs[id];
  await chrome.storage.local.set({ [KEYS.history]: history.map((h) => (h.id === id ? { ...h, handled: true } : h)), [KEYS.handoffs]: handoffs });
  await updateBadge();
}
