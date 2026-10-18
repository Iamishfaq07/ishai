/**
 * Page-wide interaction helpers that need a line of JavaScript (DESIGN.md "Interaction"). Started once by initDesign.
 *
 * Disclosures: a <details> animates open only when someone opens it. Its summary's press marks it (`data-opening`)
 * just before the browser opens it, and base.css plays the opening for marked ones only, so a details that starts
 * open, or opens from code, never grows on its own (that would shift the page under the reader).
 */
let started = false;

export function initInteractions(doc: Document | undefined = typeof document === "undefined" ? undefined : document): void {
  if (!doc || started) return;
  started = true;
  doc.addEventListener(
    "click",
    (e) => {
      const summary = (e.target as Element | null)?.closest?.("summary");
      const details = summary?.parentElement;
      if (!(details instanceof HTMLDetailsElement) || details.open || summary !== details.querySelector(":scope > summary")) return;
      details.setAttribute("data-opening", "");
      setTimeout(() => details.removeAttribute("data-opening"), 400);
    },
    true,
  );
}
