// Read-only fixture refresh. Never fills a field or presses Submit. Scripts, hidden tokens, SVGs, images and input
// values are removed before writing. These are DOM compatibility fixtures, not live submission acceptance tests.
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sources = [
  ["workable", "https://apply.workable.com/callsign/j/BD71CEB924/apply/"],
  ["recruitee", "https://constructivedialogue.recruitee.com/o/software-engineer-early-career/c/new"],
];
const directory = fileURLToPath(new URL("../test/fixtures/", import.meta.url));
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [ats, url] of sources) {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator(ats === "workable" ? "form[data-ui=application-form]" : "form#offer-application-form").waitFor();
    const html = await page.locator("form").first().evaluate((form) => {
      // Retain a small compatibility sample, not the employer's full creative screening questionnaire.
      const clone = form.cloneNode(false);
      const kept = new Set();
      for (const control of form.querySelectorAll("input")) {
        const key = control.getAttribute("name") || control.getAttribute("data-ui") || "";
        if (!/^(firstname|lastname|email|phone|address|resume|CA_4024|candidate\.(name|email|phone|cv))$/.test(key)) continue;
        let group = control.closest("fieldset") || control.parentElement;
        const id = (group.getAttribute("aria-labelledby") || control.getAttribute("aria-labelledby") || "").split(/\s+/)[0];
        const label = id ? document.getElementById(id) : control.labels?.[0];
        while (label && !group.contains(label) && group.parentElement && group.parentElement !== form) group = group.parentElement;
        if (kept.has(group)) continue;
        kept.add(group); clone.appendChild(group.cloneNode(true));
      }
      const submit = form.querySelector("button[type=submit]");
      if (submit) clone.appendChild(submit.cloneNode(true));
      clone.querySelectorAll("script, style, svg, img, iframe, input[type=hidden]").forEach((node) => node.remove());
      clone.querySelectorAll("[role=dialog], [role=listbox]").forEach((node) => node.remove());
      clone.querySelectorAll("input,textarea").forEach((node) => {
        if (!["radio", "checkbox"].includes(node.getAttribute("type"))) node.removeAttribute("value");
        node.removeAttribute("checked");
        if (node.tagName === "TEXTAREA") node.textContent = "";
      });
      for (const node of [clone, ...clone.querySelectorAll("*")]) {
        for (const name of node.getAttributeNames()) if (name === "style" || name.startsWith("on")) node.removeAttribute(name);
      }
      return clone.outerHTML;
    });
    await writeFile(`${directory}/${ats}.html`, `<!-- Read-only public form DOM. Source: ${url}; recorded 2026-10-19. No application sent. -->\n${html}\n`);
    console.log(JSON.stringify({ ats, bytes: html.length }));
    await page.close();
  }
} finally { await browser.close(); }
