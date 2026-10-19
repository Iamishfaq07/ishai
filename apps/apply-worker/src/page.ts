// Bundled for injection into a fresh hosted context. It receives one approved packet, never an Orbit credential.
import type { ApplicationPacket, ApplyResult, SubmittedPayload } from "../../extension/src/lib/autoApply/contract";
import { blocker } from "../../extension/src/lib/autoApply/detect";
import { click, shown, text } from "../../extension/src/lib/autoApply/dom";
import { checkPage, fillApplication, pressSubmit, type ResumeFile } from "../../extension/src/lib/autoApply/engine";
import { buttonByText } from "../../extension/src/lib/autoApply/adapters/common";
import { HOSTED_ADAPTERS, finalButton, nextButton, type HostedAts } from "./adapters";

export type HostedPacket = ApplicationPacket<HostedAts>;

export function inspect(doc: Document, ats: HostedAts) {
  const adapter = HOSTED_ADAPTERS[ats];
  const form = adapter.form(doc);
  const stop = blocker(doc, !!form);
  const entry = !form && buttonByText(doc, /^(apply manually|apply|start application|apply for this job)$/i, "button, [role=button], a");
  const questions = form ? adapter.questions(form).filter((q) => "el" in q.widget ? q.widget.type === "file" || shown(q.widget.el) : shown(q.container)) : [];
  const final = form && finalButton(form);
  const next = form && nextButton(form);
  const action = stop ? "blocked" : entry ? "entry" : final ? "submit" : next ? "next" : "waiting";
  const signature = [doc.location?.pathname, action,
    text(doc.querySelector("[data-automation-id=pageHeaderTitle], main h1, main h2, [aria-current=step]")),
    questions.map((q) => `${q.questionId}:${q.label}`).join("|")].join(";");
  return { action, stop, signature, email: questions.some((q) => /e-?mail/i.test(q.label) || q.attrs.type === "email"),
    resume: questions.some((q) => q.role === "resume"), success: adapter.success(doc) };
}

let run: { done: boolean; result?: { status: string; reason: string | null; unknown_questions: unknown[]; submitted: SubmittedPayload }; error?: string } | null = null;
const api = {
  inspect(ats: HostedAts) { return inspect(document, ats); },
  entry(ats: HostedAts) {
    if (inspect(document, ats).action !== "entry") return false;
    const button = buttonByText(document, /^(apply manually|apply|start application|apply for this job)$/i, "button, [role=button], a");
    if (!button) return false;
    click(button); return true;
  },
  start(packet: HostedPacket, resume: ResumeFile) {
    if (run && !run.done) return false;
    const current: NonNullable<typeof run> = { done: false };
    run = current;
    fillApplication(document, { adapter: HOSTED_ADAPTERS[packet.job.ats], packet, resume },
      { step: !["greenhouse", "lever", "ashby"].includes(packet.job.ats) }).then((out) => {
      current.result = { status: out.kind === "ready" ? "ready" : out.status,
        reason: out.kind === "stop" ? out.reason : null,
        unknown_questions: out.kind === "stop" ? out.unknown : [], submitted: out.submitted };
    }).catch(() => { current.error = "The form could not be filled."; }).finally(() => { current.done = true; });
    return true;
  },
  poll() { return run; },
  press(ats: HostedAts, expected: "next" | "submit") {
    if (!run?.done || run.result?.status !== "ready") return false;
    if (inspect(document, ats).action !== expected) return false;
    return pressSubmit(document, HOSTED_ADAPTERS[ats]);
  },
  check(ats: HostedAts) { return checkPage(document, HOSTED_ADAPTERS[ats]); },
};

declare global { var __orbitHosted: typeof api; }
globalThis.__orbitHosted = api;
export type HostedResult = ApplyResult;
