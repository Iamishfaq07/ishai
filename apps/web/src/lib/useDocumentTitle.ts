import { useEffect } from "react";

/**
 * Sets the browser tab title, and the meta description when this page has one. `exact` uses the title as it is
 * (a public page's served title, lib/servedHead.ts) instead of adding " · Orbit".
 */
export function useDocumentTitle(title: string | null | undefined, description?: string | null, exact = false): void {
  useEffect(() => {
    document.title = title ? (exact ? title : `${title} · Orbit`) : "Orbit";
    if (!description) return;
    let el = document.querySelector('meta[name="description"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", "description");
      document.head.appendChild(el);
    }
    el.setAttribute("content", description);
  }, [title, description, exact]);
}
