// Types for meta.js, so the web app's TypeScript (the build-time prerender and its tests) can import it.
export const PAGE_META: Record<string, { title: string; description: string }>;
export function metaFor(pathname: string): ({ path: string; title: string; description: string }) | null;
export function withPageMeta(response: Response, url: URL): Response;
