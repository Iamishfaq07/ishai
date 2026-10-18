// Lever hosted postings (jobs.lever.co/<company>/<id>/apply). One page: resume upload (Lever reads it and may
// prefill name/email/phone), the standard fields, custom question cards (cards[<id>][fieldN]), optional EEO surveys,
// and "Additional information". The submit button runs Lever's hCaptcha check first; success is its thanks page.
import { click, labelOf, shown, sleep, text, visibleTexts, waitFor, pace } from "../dom";
import { cleanLabel, normalize } from "../match";
import { attrsOf, widgetFor, type Question } from "../questions";
import type { Adapter } from "./types";
import { buttonByText, controlRequired, controlsIn, markedRequired, thanksText, uploadShown } from "./common";

function questionsIn(form: Element): Question[] {
  const out: Question[] = [];
  const items = [...form.querySelectorAll("li.application-question")];
  for (const li of items) {
    const controls = controlsIn(li);
    if (!controls.length) continue;
    // A custom card's question can hold more than one field: one question per name.
    const names = [...new Set(controls.map((c) => c.getAttribute("name") ?? ""))];
    const groups = li.classList.contains("custom-question") && names.length > 1 ? names.map((n) => controls.filter((c) => (c.getAttribute("name") ?? "") === n)) : [controls];
    for (const group of groups) {
      // Pronoun pickers etc. pair a checkbox list with a hidden "custom" text box: the list is the question.
      const pick = group.some((c) => ["checkbox", "radio"].includes(c.getAttribute("type") ?? "")) ? group.filter((c) => ["checkbox", "radio"].includes(c.getAttribute("type") ?? "")) : group;
      const widget = widgetFor(pick);
      if (!widget) continue;
      const labelEl = li.querySelector(".application-label .text") ?? li.querySelector(".application-label");
      const first = pick[0]!;
      const label = cleanLabel(text(labelEl).replace(/✱/g, "")) || (widget.type === "checkbox" ? labelOf(first) : "");
      const section = text(li.closest(".section, [class*=eeo], [class*=survey]")?.querySelector("h4, .section-header, .eeo-title")).slice(0, 300);
      out.push({
        questionId: first.getAttribute("name") || first.getAttribute("id"),
        label: widget.type === "file" && !label ? "Resume/CV" : label,
        required: pick.some(controlRequired) || markedRequired(labelEl) || !!li.querySelector(".required-field"),
        widget,
        container: li,
        section,
        role: widget.type === "file" ? (first.getAttribute("name") === "resume" ? "resume" : /cover/i.test(label) ? "cover_letter" : null) : null,
        attrs: attrsOf(first),
      });
    }
  }
  const comments = form.querySelector<HTMLTextAreaElement>("textarea[name=comments]");
  if (comments) {
    out.push({
      questionId: "comments",
      label: "Additional information",
      required: comments.required,
      widget: { type: "text", el: comments },
      container: comments.closest(".application-additional") ?? comments.parentElement!,
      section: "",
      role: "cover_letter",
      attrs: attrsOf(comments),
    });
  }
  return out;
}

export const lever: Adapter = {
  ats: "lever",
  hosts: ["jobs.lever.co"],
  form(doc) {
    return doc.querySelector("form#application-form") ?? doc.querySelector("input[name=resume], #btn-submit")?.closest("form") ?? null;
  },
  questions: questionsIn,
  submitButton(form) {
    return form.querySelector<HTMLElement>("#btn-submit") ?? buttonByText(form, /submit/i);
  },
  success(doc) {
    const onThanks = /\/thanks\b/.test(doc.location?.pathname ?? "");
    const thanks = thanksText(doc, "h1, h2, h3, h4, .template-content, .thanks, [class*=thank], [class*=success], [role=status]");
    if (thanks && (onThanks || !this.form(doc))) return thanks;
    return null;
  },
  errors(doc) {
    return visibleTexts(doc, ".application-error, .error-message, li.error .error, .error:not(form):not(li), [role=alert]").filter((t) => t.length > 1);
  },
  upload(q, filename) {
    const li = q.container;
    if (shown(li.querySelector(".resume-upload-working"))) return "pending";
    const name = text(li.querySelector(".filename"));
    if (name) return "ok";
    return uploadShown(li, filename, ".resume-upload-oversize .error-message, .error-message");
  },
  busy(doc) {
    return shown(doc.querySelector(".resume-upload-working"));
  },
  async afterType(q, value) {
    // Lever's location box suggests places; take one only when it is the place typed (never a guess).
    if (q.attrs.name !== "location") return;
    const want = normalize(value);
    const option = await waitFor(() => {
      for (const el of q.container.querySelectorAll<HTMLElement>(".dropdown-location, .dropdown-results [role=option], .dropdown-results div")) {
        if (shown(el) && normalize(text(el)) === want) return el;
      }
      return null;
    }, 2500 * Math.max(pace(), 0.2));
    if (option) {
      await sleep(200 * pace());
      click(option);
    }
  },
};
