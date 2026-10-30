import { useEffect } from "react";
import { SITE } from "../../worker/origin.js";
import type { Head } from "../prerender/seo";

function meta(attribute: "name" | "property", key: string, value: string | null) {
  const selector = `meta[${attribute}="${key}"]`;
  const existing = [...document.head.querySelectorAll<HTMLMetaElement>(selector)];
  if (value === null) { existing.forEach((node) => node.remove()); return; }
  const node = existing.shift() ?? document.createElement("meta");
  node.setAttribute(attribute, key); node.content = value;
  if (!node.isConnected) document.head.appendChild(node);
  existing.forEach((duplicate) => duplicate.remove());
}

/** Replace route-owned head elements; private views never inherit public schema or a stale canonical. */
export function applyRouteMetadata(head: Head | null, preview: boolean) {
  document.head.querySelectorAll('link[rel="canonical"], link[hreflang], link[rel="alternate"][type="text/markdown"], script[type="application/ld+json"]')
    .forEach((node) => node.remove());
  meta("name", "robots", !head || head.noindex || preview ? "noindex,follow" : "index,follow");
  if (head) {
    document.title = head.title;
    const canonical = document.createElement("link");
    canonical.rel = "canonical"; canonical.href = head.canonical; document.head.appendChild(canonical);
    for (const language of ["en", "x-default"]) {
      const alternate = document.createElement("link"); alternate.rel = "alternate";
      alternate.hreflang = language; alternate.href = head.canonical; document.head.appendChild(alternate);
    }
    const markdown = document.createElement("link");
    markdown.rel = "alternate"; markdown.type = "text/markdown";
    markdown.href = head.canonical.replace(/\/$/, "") + (new URL(head.canonical).pathname === "/" ? "/index.md" : ".md");
    if (!head.noindex) document.head.appendChild(markdown);
    if (head.jsonLd) {
      const schema = document.createElement("script"); schema.type = "application/ld+json";
      schema.textContent = JSON.stringify(head.jsonLd).replace(/</g, "\\u003c"); document.head.appendChild(schema);
    }
    meta("name", "description", head.description);
  }
  const description = head?.description ?? document.head.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null;
  for (const [attribute, prefix] of [["property", "og"], ["name", "twitter"]] as const) {
    meta(attribute, `${prefix}:title`, head?.title ?? document.title);
    meta(attribute, `${prefix}:description`, description);
    meta(attribute, `${prefix}:image`, head?.ogImage ?? null);
    meta(attribute, `${prefix}:image:alt`, head?.title ?? null);
  }
  meta("property", "og:url", head?.canonical ?? null);
  meta("property", "og:type", head ? "website" : null);
}

export function useRouteMetadata(pathname: string, privateView: boolean) {
  useEffect(() => {
    let active = true;
    const preview = window.location.host !== new URL(SITE).host;
    if (privateView) { applyRouteMetadata(null, preview); return; }
    // The head's structured data, page descriptions and FAQs load after first paint, not in every page's entry.
    void import("./publicPageHead").then(({ publicPageHead }) => publicPageHead(pathname)).then((head) => {
      if (active) applyRouteMetadata(head, preview);
    }).catch(() => {
      if (!active) return;
      // Keep a valid server-rendered head if a lazy metadata chunk fails on the initial page.
      const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
      const normalize = (path: string) => path.replace(/\/+$/, "") || "/";
      if (!canonical || normalize(new URL(canonical).pathname) !== normalize(pathname)) applyRouteMetadata(null, preview);
    });
    return () => { active = false; };
  }, [pathname, privateView]);
}
