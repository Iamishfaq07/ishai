// Types for routes.js, so the web app's TypeScript (the prerender's tests) can check its pages against the Worker's list.
export const PUBLIC_APP_PAGES: string[];
export const POLICY_PAGES: string[];
export const PUBLIC_SECTIONS: string[];
export const APP_ROUTES: RegExp[];
export function routeKind(pathname: string): "public" | "app" | "referral" | null;
