import { useEffect } from "react";

/** Sets the browser tab title, and the meta description when this page has one. */
export function useDocumentTitle(title: string | null | undefined, description?: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · Orbit` : "Orbit";
    if (!description) return;
    let el = document.querySelector('meta[name="description"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", "description");
      document.head.appendChild(el);
    }
    el.setAttribute("content", description);
  }, [title, description]);
}
