// Types for seo.js, so the web app's TypeScript (the prerender's tests) can check the built pages against the Worker.
export function originOf(env?: Record<string, unknown>): string;
export function canonicalLocation(url: URL, env?: Record<string, unknown>): string | null;
export function robotsTxt(env?: Record<string, unknown>, url?: URL): string;
export const SEARCH_CRAWLERS: string[];
export const TRAINING_CRAWLERS: string[];
export const BLOCKED_CRAWLERS: string[];
