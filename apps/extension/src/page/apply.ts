// Injected (isolated world) into an ATS application page that auto-apply opened, or into the candidate's own tab for
// a "Needs you" hand-off. Only ever on the Greenhouse, Lever and Ashby hosts the candidate granted. The service worker
// calls these through chrome.scripting.
import { ADAPTERS } from "../lib/autoApply/adapters";
import type { ApplicationPacket, Ats, UnknownQuestion } from "../lib/autoApply/contract";
import { setQuick } from "../lib/autoApply/dom";
import { checkPage, fillApplication, pressSubmit, type ResumeFile, type RunOutcome } from "../lib/autoApply/engine";

const PANEL = "orbit-apply-panel";

function panel(lines: string[], items: UnknownQuestion[]): void {
  document.getElementById(PANEL)?.remove();
  const box = document.createElement("div");
  box.id = PANEL;
  box.setAttribute("role", "status");
  box.style.cssText =
    "position:fixed;z-index:2147483647;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;padding:12px 16px;" +
    "border-radius:12px;background:#1e1b4b;color:#fff;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3);max-height:45vh;overflow:auto";
  for (const line of lines) {
    const p = document.createElement("p");
    p.style.margin = "0 0 6px";
    p.textContent = line;
    box.appendChild(p);
  }
  if (items.length) {
    const ul = document.createElement("ul");
    ul.style.margin = "0 0 6px 18px";
    for (const q of items) {
      const li = document.createElement("li");
      li.textContent = q.label;
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Dismiss";
  close.style.cssText = "background:transparent;color:#c7d2fe;border:1px solid #6366f1;border-radius:8px;padding:2px 10px;cursor:pointer";
  close.onclick = () => box.remove();
  box.appendChild(close);
  document.body.appendChild(box);
}

const WHY: Record<string, string> = {
  captcha: "This site asked for a human check. Solve it, then press Submit.",
  login: "This site wants you to sign in first. Sign in, then finish the application.",
  email_verification: "This site sent a code to your email. Enter it to finish.",
  unknown_question: "Orbit had no approved answer for these questions. Answer them, then press Submit:",
  form_changed: "Orbit couldn't finish this form on its own. Check every field, then press Submit.",
  blocked: "This site blocked the automatic attempt. Check every field, then press Submit.",
  error: "Something went wrong (for example the resume didn't attach). Check every field, then press Submit.",
};

// The fill takes minutes at a person's pace: it runs here on its own and the service worker polls for the outcome
// (no single long-running call that a service worker could be stopped in the middle of).
let current: { done: boolean; outcome: RunOutcome | null; error: string | null } | null = null;

const api = {
  /** Starts filling at a person's pace; never submits. */
  start(ats: Ats, packet: ApplicationPacket, resume: ResumeFile | null): boolean {
    if (current && !current.done) return false;
    setQuick(false);
    const run: NonNullable<typeof current> = { done: false, outcome: null, error: null };
    current = run;
    fillApplication(document, { adapter: ADAPTERS[ats], packet, resume })
      .then((o) => (run.outcome = o))
      .catch((e: unknown) => (run.error = e instanceof Error ? e.message : String(e)))
      .finally(() => (run.done = true));
    return true;
  },
  poll(): { done: boolean; outcome: RunOutcome | null; error: string | null } | null {
    return current && { ...current };
  },
  submit(ats: Ats): boolean {
    return pressSubmit(document, ADAPTERS[ats]);
  },
  check(ats: Ats) {
    return checkPage(document, ADAPTERS[ats]);
  },
  /** The "Needs you" hand-off, in the candidate's own tab: fill what Orbit can, outline it, say what's left. */
  async prepare(ats: Ats, packet: ApplicationPacket, resume: ResumeFile | null, reason: string | null): Promise<RunOutcome> {
    setQuick(true);
    const out = await fillApplication(document, { adapter: ADAPTERS[ats], packet, resume, mark: true }, { handoff: true });
    const unknown = out.kind === "stop" ? out.unknown : [];
    const filled = Object.keys(out.submitted.fields).length + out.submitted.answers.length;
    const lines = [`Orbit filled ${filled} field${filled === 1 ? "" : "s"} from your approved answers (outlined in purple).`];
    const why = (out.kind === "stop" && out.reason) || reason;
    lines.push(why && WHY[why] ? WHY[why] : "Check every field, then press Submit when you're ready.");
    if (!unknown.length && why === "unknown_question") lines.push("Check every field, then press Submit when you're ready.");
    lines.push("Orbit won't press Submit on this tab: that's yours.");
    panel(lines, unknown);
    return out;
  },
};

(globalThis as unknown as { __orbitApply: typeof api }).__orbitApply = api;
export type ApplyPageApi = typeof api;
