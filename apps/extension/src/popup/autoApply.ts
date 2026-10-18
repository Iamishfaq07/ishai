// The popup's "Auto-apply" section: what it does, the opt-in (which asks for the four ATS sites, and gives them back
// when turned off), today's count, pause/resume, and the last results with "Needs you" hand-offs.
import { ATS_ORIGINS } from "../lib/autoApply/adapters";
import type { ApplyReason, ApplyStatus } from "../lib/autoApply/contract";
import { getHistory, getSettings, KEYS, setSettings, type CurrentRun, type HistoryItem } from "../lib/autoApply/state";

type Call = <T>(path: string, init?: RequestInit) => Promise<T>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids);
  return el;
}

const REASONS: Record<ApplyReason, string> = {
  captcha: "the site asked for a human check",
  login: "the site wants you to sign in",
  email_verification: "the site sent you an email code",
  unknown_question: "a question has no approved answer yet",
  form_changed: "Orbit didn't recognise the form",
  blocked: "the site blocked the attempt",
  error: "something went wrong",
};

const STATUS: Record<HistoryItem["status"], string> = { submitted: "Submitted", needs_you: "Needs you", failed: "Didn't go through", skipped: "Skipped" };

function send(message: unknown): void {
  // The popup may close before the runner answers: nothing waits on it.
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

function resultRow(item: HistoryItem, refresh: () => void): HTMLElement {
  const link = h("a", { href: item.status === "submitted" && item.finalUrl ? item.finalUrl : item.url, target: "_blank", rel: "noopener", textContent: `${item.title} at ${item.company}` });
  const row = h("li", { className: `result ${item.status}` }, h("strong", { textContent: STATUS[item.status] }), " ", link);
  if (item.reason && item.status !== "submitted") row.append(h("span", { className: "muted", textContent: ` (${REASONS[item.reason] ?? item.reason})` }));
  if (item.status === "needs_you" && !item.handled) {
    const finish = h("button", { className: "primary small", textContent: "Finish it" });
    finish.onclick = () => {
      finish.disabled = true;
      send({ type: "autoApply:handoff", id: item.id });
    };
    const dismiss = h("button", { className: "small", textContent: "Dismiss" });
    dismiss.onclick = () => {
      send({ type: "autoApply:dismiss", id: item.id });
      setTimeout(refresh, 300);
    };
    row.append(h("div", { className: "row" }, finish, dismiss));
    if (item.unknown.length) row.append(h("p", { className: "muted", textContent: `To answer: ${item.unknown.map((q) => q.label).join("; ")}` }));
  }
  return row;
}

function switchLabel(toggle: HTMLInputElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "switch";
  label.append(toggle, " Apply for me automatically");
  return label;
}

export function autoApplySection(call: Call): HTMLElement {
  const box = h("section", { className: "auto-apply" });
  void render(box, call);
  return box;
}

async function render(box: HTMLElement, call: Call): Promise<void> {
  const settings = await getSettings();
  const refresh = () => void render(box, call);
  const toggle: HTMLInputElement = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = settings.enabled;
  toggle.id = "auto-apply-toggle";
  toggle.setAttribute("role", "switch");
  const note = h("p", { className: "muted" });
  toggle.onchange = () => {
    if (toggle.checked) {
      // Asked for here, on the click: the browser shows what's being granted.
      chrome.permissions
        .request({ origins: ATS_ORIGINS })
        .then(async (granted) => {
          if (!granted) {
            toggle.checked = false;
            note.textContent = "Auto-apply needs those four sites to fill applications on them. Nothing was changed.";
            return;
          }
          await setSettings({ enabled: true, paused: false });
          refresh();
        })
        .catch(() => {
          toggle.checked = false;
        });
    } else {
      void chrome.permissions
        .remove({ origins: ATS_ORIGINS })
        .catch(() => false)
        .then(() => setSettings({ enabled: false }))
        .then(refresh);
    }
  };
  const parts: Node[] = [
    h("h2", { textContent: "Auto-apply" }),
    h(
      "p",
      { className: "muted" },
      "Orbit applies for you to the jobs it has prepared on Greenhouse, Lever and Ashby career pages, using only your approved resume and answers. " +
        'It works in this browser while it\'s open, in its own window labelled "Orbit Apply", at a person\'s pace, one application at a time. ' +
        "It stops and asks you when a site wants a human check, a sign-in or an email code, or asks something you haven't answered. It never solves captchas or hides what it does.",
    ),
    switchLabel(toggle),
    h("p", { className: "muted" }, "Turning it on asks your browser to let Orbit open and fill pages on boards.greenhouse.io, job-boards.greenhouse.io, jobs.lever.co and jobs.ashbyhq.com. Turning it off gives that back."),
    note,
  ];
  if (settings.enabled) {
    const status = h("p", { textContent: "Checking…" });
    parts.push(status);
    const { [KEYS.current]: cur, [KEYS.lastError]: lastError } = await chrome.storage.local.get([KEYS.current, KEYS.lastError]);
    const current = cur as CurrentRun | undefined;
    if (current) parts.push(h("p", { className: "ok", textContent: `Applying now: ${current.title} at ${current.company}.` }));
    const pause = h("button", { textContent: settings.paused ? "Resume" : "Pause" });
    pause.onclick = async () => {
      await setSettings({ paused: !settings.paused });
      refresh();
    };
    const now = h("button", { textContent: "Check now" });
    now.onclick = () => {
      send({ type: "autoApply:refresh" });
      now.disabled = true;
    };
    parts.push(h("div", { className: "row" }, pause, ...(settings.paused ? [] : [now])));
    if (settings.paused) parts.push(h("p", { className: "warn", textContent: "Paused. Nothing new starts until you resume." }));
    if (typeof lastError === "string" && lastError) parts.push(h("p", { className: "muted", textContent: `Last check: ${lastError}` }));
    call<ApplyStatus>("/v1/apply/status")
      .then((s) => {
        const next = s.next_due ? new Date(s.next_due).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : null;
        status.textContent = `Today: ${s.today} of ${s.limit} applications.` + (s.paused ? " Paused in Orbit." : next ? ` Next: ${next}.` : "");
      })
      .catch((e: unknown) => {
        status.textContent = e instanceof Error && /404/.test(e.message) ? "Auto-apply isn't available on your Orbit account yet." : "Couldn't reach Orbit for today's count.";
      });
  }
  const history = (await getHistory()).slice(0, 5);
  if (history.length) {
    parts.push(h("h3", { textContent: "Latest" }), h("ul", { className: "results" }, ...history.map((item) => resultRow(item, refresh))));
  }
  box.replaceChildren(...parts);
}
