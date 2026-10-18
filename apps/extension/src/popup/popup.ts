import type { ClippedJob } from "../lib/job";
import type { Profile } from "../page/fill";
import { autoApplySection } from "./autoApply";

declare const __ORBIT_WEB_URL__: string;
declare const __ORBIT_API_URL__: string;
const WEB = __ORBIT_WEB_URL__;
const API = __ORBIT_API_URL__;

type Api = { extractJob: () => ClippedJob; fillForm: (p: Profile) => { filled: string[] } };

const app = document.getElementById("app")!;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids);
  return el;
}

function show(...nodes: Node[]): void {
  app.replaceChildren(...nodes);
}

async function token(): Promise<string | null> {
  const { token: t } = await chrome.storage.local.get(["token"]);
  return typeof t === "string" ? t : null;
}

class SignedOut extends Error {}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const t = await token();
  if (!t) throw new SignedOut();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 401) {
    await chrome.storage.local.remove(["token"]);
    throw new SignedOut();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
    const d = body.detail;
    const text = typeof d === "string" ? d : d && typeof d === "object" && "message" in d ? String((d as { message: unknown }).message) : "";
    throw new Error(text || `Orbit answered ${res.status}.`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url ?? "")) throw new Error("Open a job page first. Orbit can't read this kind of page.");
  return tab;
}

/** Runs one of the page helpers in the current tab (only when the person clicks: activeTab). The function given to
 * executeScript is serialized into the page, so it can't close over anything: the method and argument are passed in. */
async function inPage<R>(method: keyof Api, arg: unknown = null): Promise<R> {
  const tab = await activeTab();
  await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ["page.js"] });
  const [out] = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: ((m: string, a: unknown) => {
      const api = (globalThis as unknown as { __orbitExtension: Record<string, (x: unknown) => unknown> }).__orbitExtension;
      return api[m]!(a);
    }) as (...args: never[]) => R,
    args: [method, arg],
  });
  return out?.result as R;
}

function error(err: unknown): HTMLElement {
  return h("p", { className: "warn", textContent: err instanceof Error ? err.message : "Something went wrong." });
}

function connectView(): void {
  const button = h("button", { className: "primary", textContent: "Connect to Orbit" });
  button.onclick = () => void chrome.tabs.create({ url: `${WEB}/extension/connect` });
  show(
    h("p", {}, "Clip jobs to your Orbit tracker, see which of a job's keywords your resume covers, and fill an application's basic fields for you to check."),
    h("div", { className: "row" }, button),
    h("p", { className: "muted" }, "You'll sign in on Orbit's site. The extension only reads the page you're on when you click a button here. It submits applications only if you turn on auto-apply."),
  );
}

async function home(): Promise<void> {
  let me: { email: string; name: string | null };
  try {
    me = await call("/v1/extension/me");
  } catch (err) {
    if (err instanceof SignedOut) return connectView();
    return show(error(err));
  }
  const clip = h("button", { className: "primary", textContent: "Clip this job" });
  const fill = h("button", { textContent: "Fill this application" });
  const out = h("div");
  clip.onclick = () => void clipJob(out);
  fill.onclick = () => void fillApplication(out, fill);
  const signOut = h("button", { textContent: "Sign out of the extension" });
  signOut.onclick = async () => {
    await call("/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    await chrome.storage.local.remove(["token"]);
    connectView();
  };
  show(
    h("p", { className: "muted" }, `Signed in as ${me.email}`),
    h("div", { className: "row" }, clip, fill),
    out,
    h("hr"),
    autoApplySection(call),
    h("hr"),
    h("div", { className: "row" }, signOut),
  );
}

function field(label: string, value: string, multiline = false): [HTMLLabelElement, HTMLInputElement | HTMLTextAreaElement] {
  const input: HTMLInputElement | HTMLTextAreaElement = document.createElement(multiline ? "textarea" : "input");
  input.value = value;
  const wrap = document.createElement("label");
  wrap.append(label, input);
  return [wrap, input];
}

async function clipJob(out: HTMLElement): Promise<void> {
  let job: ClippedJob;
  try {
    job = await inPage<ClippedJob>("extractJob");
  } catch (err) {
    return out.replaceChildren(error(err));
  }
  const [titleL, title] = field("Job title", job.title);
  const [companyL, company] = field("Company", job.company);
  const [placeL, place] = field("Location", job.location);
  const [urlL, url] = field("Link", job.url);
  const save = h("button", { className: "primary", textContent: "Save to tracker" });
  const fit = h("button", { textContent: "Check my resume against it" });
  const result = h("div");
  save.onclick = async () => {
    save.disabled = true;
    try {
      await call("/v1/jobs/tracker/manual", {
        method: "POST",
        body: JSON.stringify({ title: title.value, company: company.value, location: place.value, url: url.value, status: "saved" }),
      });
      result.replaceChildren(h("p", { className: "ok" }, "Saved to your tracker. ", h("a", { href: `${WEB}/jobs/tracker`, target: "_blank", rel: "noopener", textContent: "Open it" })));
    } catch (err) {
      save.disabled = false;
      result.replaceChildren(error(err));
    }
  };
  fit.onclick = async () => {
    fit.disabled = true;
    try {
      const r = await call<{ resume_title: string | null; matched: string[]; missing: string[]; coverage_pct: number | null }>("/v1/extension/fit", {
        method: "POST",
        body: JSON.stringify({ job_text: [title.value, company.value, job.description].join("\n") }),
      });
      result.replaceChildren(
        r.coverage_pct === null
          ? h("p", { className: "muted" }, "This page didn't list skills Orbit could check.")
          : h("p", {}, `Your resume${r.resume_title ? ` "${r.resume_title}"` : ""} mentions ${r.matched.length} of the ${r.matched.length + r.missing.length} keywords found (${r.coverage_pct}%).`),
        ...(r.missing.length ? [h("p", { className: "muted" }, "Not on your resume yet:"), h("div", { className: "chips" }, ...r.missing.map((k) => h("span", { className: "chip", textContent: k })))] : []),
        h("p", { className: "muted" }, "Keyword coverage only, not a prediction. Add only what you've really done."),
      );
    } catch (err) {
      result.replaceChildren(error(err));
    } finally {
      fit.disabled = false;
    }
  };
  out.replaceChildren(
    h("p", { className: "muted" }, job.description ? "Check these before saving." : "Couldn't read much from this page: fill in what's missing."),
    titleL, companyL, placeL, urlL,
    h("div", { className: "row" }, save, ...(job.description.length >= 40 ? [fit] : [])),
    result,
  );
}

async function fillApplication(out: HTMLElement, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    const profile = await call<Profile & { resume_title: string | null }>("/v1/extension/profile");
    const { filled } = await inPage<{ filled: string[] }>("fillForm", profile);
    out.replaceChildren(
      filled.length
        ? h("p", { className: "ok" }, `Filled ${filled.length} field${filled.length === 1 ? "" : "s"} from ${profile.resume_title ? `"${profile.resume_title}"` : "your profile"}.`)
        : h("p", { className: "muted" }, "No empty name, email, phone or link fields found on this page."),
      h("p", { className: "muted" }, "Check every field on the page and answer the rest yourself. Orbit doesn't submit this one: that's yours."),
    );
  } catch (err) {
    out.replaceChildren(error(err));
  } finally {
    button.disabled = false;
  }
}

void home();
