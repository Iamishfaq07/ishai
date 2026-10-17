/**
 * The head the server wrote for the page this document was served as: a public page's own title and description
 * (the Worker's link previews, the prerendered pages; worker/meta.js, src/prerender). Those are what search engines
 * index. The app's short tab titles ("Resume AI · Orbit") would replace them as soon as the scripts ran, and Google
 * reads the page after its scripts run, so on that page, signed out, the app keeps the served head (DECISIONS D67).
 * A page the server wrote its own head for names itself in its canonical link; the app's own pages have none.
 */
export interface ServedHead {
  title: string;
  description: string | null;
}

const norm = (path: string): string => path.replace(/\/+$/, "") || "/";

/** The served head of a document, from what it says (exported for the unit test). */
export function servedHeadOf(doc: {
  href: string;
  title: string;
  canonical: string | null | undefined;
  description: string | null | undefined;
}): { path: string; head: ServedHead } | null {
  if (!doc.canonical || !doc.title) return null;
  try {
    const path = norm(new URL(doc.href).pathname);
    if (norm(new URL(doc.canonical, doc.href).pathname) !== path) return null;
    return { path, head: { title: doc.title, description: doc.description ?? null } };
  } catch {
    return null;
  }
}

const served =
  typeof document === "undefined" || typeof window === "undefined"
    ? null
    : servedHeadOf({
        href: window.location.href,
        title: document.title,
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
        description: document.querySelector('meta[name="description"]')?.getAttribute("content"),
      });

/** The served head when `pathname` is the page the document was served as, else null. */
export function servedHeadFor(pathname: string): ServedHead | null {
  return served && served.path === norm(pathname) ? served.head : null;
}
