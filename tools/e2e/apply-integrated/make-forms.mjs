// Makes the server-side copies of the recorded application forms (tools/e2e/ats-fixtures) for the integrated Orbit
// Apply run (apply-integrated.spec.ts): what Orbit's API would read from Greenhouse's board API, Lever's apply page and
// Ashby's GraphQL for those same jobs, so the planner answers the questions the extension then finds on the pages.
// Built from the extension's own reading of each page (its adapters, in jsdom), with the dropdown options the fake
// ATS (ats-fixtures/fake-ats.js) offers. Run once, by hand, when a fixture changes:
//   1. the questions: a throwaway vitest file in apps/extension that writes ADAPTERS[ats].questions(form) as JSON
//      ({id, label, required, widget, shown, options}) per fixture to $DUMP_OUT;
//   2. node tools/e2e/apply-integrated/make-forms.mjs <that JSON>
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dump = JSON.parse(readFileSync(process.argv[2], "utf8"));
const shown = (name) => dump[name].filter((q) => q.shown);
// fake-ats.js's dropdown options (the recorded react-select menus have none until opened).
const EEO = {
  gender: ["Male", "Female", "Decline To Self Identify"],
  hispanic_ethnicity: ["Yes", "No", "Decline To Self Identify"],
  veteran_status: ["I am not a protected veteran", "I identify as one or more of the classifications of protected veteran", "I don't wish to answer"],
};
const comboOptions = (q) => EEO[q.id] ?? (/country/i.test(q.label) ? ["India", "Indonesia", "United Kingdom", "United States"] : ["Yes", "No"]);
const values = (opts) => opts.map((o, i) => ({ label: o, value: String(i + 1) }));

// ---- Greenhouse: GET boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}?questions=true ----
function greenhouse(name, title) {
  const questions = [];
  const compliance = [];
  for (const q of shown(name)) {
    if (q.id === "country" || q.id === "candidate-location" || /^\d+$/.test(q.id)) continue; // phone country, location, the demographic survey
    const type = q.widget === "file" ? "input_file" : q.widget === "combobox" ? "multi_value_single_select" : "input_text";
    const field = { name: q.id, type, values: type === "multi_value_single_select" ? values(comboOptions(q)) : [] };
    const entry = { label: q.label, required: q.required, description: null, fields: [field] };
    if (EEO[q.id]) compliance.push(entry);
    else questions.push(entry);
  }
  return { id: 1, title, questions, location_questions: [], compliance: compliance.length ? [{ type: "eeoc", questions: compliance }] : [], demographic_questions: null, data_compliance: [] };
}

// ---- Lever: jobs.lever.co/{site}/{id}/apply (the parts lever_form reads) ----
function lever(name) {
  const qs = shown(name);
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const std = qs.filter((q) => !q.id.startsWith("cards["));
  const inputs = std.map((q) => (q.id === "comments" ? `<textarea name="comments"></textarea>` : `<input type="${q.widget === "file" ? "file" : "text"}" name="${esc(q.id)}"${q.required ? " required" : ""}>`));
  const cards = new Map();
  for (const q of qs.filter((x) => x.id.startsWith("cards["))) {
    const [, card, n] = q.id.match(/^cards\[([^\]]+)\]\[field(\d+)\]$/);
    const type = q.widget === "checkboxes" ? "multiple-select" : q.widget === "radio" ? "multiple-choice" : q.widget === "select" ? "dropdown" : "text";
    const fields = cards.get(card) ?? [];
    fields[Number(n)] = { type, text: q.label, required: q.required, options: q.options.map((o) => ({ text: o })) };
    cards.set(card, fields);
  }
  const hidden = [...cards].map(([card, fields]) => `<input type="hidden" value="${esc(JSON.stringify({ fields }))}" name="cards[${card}][baseTemplate]">`);
  return `<!doctype html>\n<!-- Server-side copy of ${name} for apply-integrated.spec.ts (make-forms.mjs). -->\n<html><body><form>\n${[...inputs, ...hidden].join("\n")}\n</form></body></html>\n`;
}

// ---- Ashby: jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting ----
function ashby(name, title) {
  const entry = (q) => {
    const type = q.widget === "file" ? "File" : q.id === "_systemfield_email" ? "Email" : q.label === "Phone" ? "Phone" : q.id === "_systemfield_location" ? "Location"
      : q.widget === "yesno" ? "Boolean" : q.widget === "radio" ? "ValueSelect" : q.widget === "checkboxes" ? "MultiValueSelect" : "String";
    return { id: `entry-${q.id}`, isRequired: q.required, isHidden: false, descriptionHtml: null, field: { id: q.id, path: q.id, title: q.label, type, selectableValues: q.options.map((o) => ({ label: o, value: o })) } };
  };
  const qs = shown(name);
  const form = qs.filter((q) => !q.id.startsWith("_systemfield_eeoc"));
  const survey = qs.filter((q) => q.id.startsWith("_systemfield_eeoc"));
  return { data: { jobPosting: { id: "1", title, applicationForm: { id: "f", sections: [{ title: null, fieldEntries: form.map(entry) }] }, surveyForms: [{ id: "s", sections: [{ title: "EEOC", fieldEntries: survey.map(entry) }] }] } } };
}

writeFileSync(join(here, "greenhouse-gitlab.json"), JSON.stringify(greenhouse("greenhouse-gitlab", "Backend Engineer"), null, 1) + "\n");
writeFileSync(join(here, "lever-palantir.html"), lever("lever-palantir"));
writeFileSync(join(here, "ashby-notion.json"), JSON.stringify(ashby("ashby-notion", "Backend Engineer"), null, 1) + "\n");
console.log("wrote greenhouse-gitlab.json, lever-palantir.html, ashby-notion.json");
