import { useEffect, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";

export interface PrepContext {
  role: string;
  company: string;
  interview_stage: string;
  tech_stack: string[];
  key_requirements: string[];
}

const KEY = "orbit.prep-context.v1:";
const empty = (): PrepContext => ({ role: "", company: "", interview_stage: "", tech_stack: [], key_requirements: [] });
const text = (v: unknown, max: number): string => typeof v === "string" ? v.trim().slice(0, max) : "";
const list = (v: unknown, count: number, max: number): string[] => Array.isArray(v)
  ? v.filter((s): s is string => typeof s === "string").map((s) => text(s, max)).filter(Boolean).slice(0, count) : [];

export function cleanPrepContext(value: Partial<PrepContext>): PrepContext {
  return { role: text(value.role, 120), company: text(value.company, 120), interview_stage: text(value.interview_stage, 80),
    tech_stack: list(value.tech_stack, 30, 100), key_requirements: list(value.key_requirements, 20, 400) };
}

function arrayParam(params: URLSearchParams, key: string): string[] | undefined {
  if (!params.has(key)) return undefined;
  try { return list(JSON.parse(params.get(key) ?? "[]") as unknown, 20, 400); } catch { return []; }
}

export function readPrepContext(params: URLSearchParams, userId: string | undefined, storage?: Storage): PrepContext {
  let saved = empty();
  try {
    const raw = storage?.getItem(KEY + (userId ?? "guest"));
    if (raw) saved = cleanPrepContext(JSON.parse(raw) as Partial<PrepContext>);
  } catch { /* Private browsing and malformed storage must not block preparation. */ }
  return cleanPrepContext({
    role: params.get("role") ?? saved.role, company: params.get("company") ?? saved.company,
    interview_stage: params.get("interview_stage") ?? saved.interview_stage,
    tech_stack: arrayParam(params, "tech_stack") ?? saved.tech_stack,
    key_requirements: arrayParam(params, "key_requirements") ?? saved.key_requirements,
  });
}

export function prepParams(context: PrepContext, base = new URLSearchParams()): URLSearchParams {
  const next = new URLSearchParams(base);
  for (const k of ["role", "company", "interview_stage"] as const) {
    if (context[k]) next.set(k, context[k]); else next.delete(k);
  }
  for (const k of ["tech_stack", "key_requirements"] as const) {
    if (context[k].length) next.set(k, JSON.stringify(context[k])); else next.delete(k);
  }
  return next;
}

export function usePrepContext(params: URLSearchParams, setParams: SetURLSearchParams, userId?: string) {
  const [context, setContext] = useState(() => {
    try { return readPrepContext(params, userId, window.sessionStorage); }
    catch { return readPrepContext(params, userId); }
  });
  const query = params.toString();
  useEffect(() => {
    try { window.sessionStorage.setItem(KEY + (userId ?? "guest"), JSON.stringify(context)); } catch { /* Storage blocked. */ }
    const next = prepParams(context, new URLSearchParams(query));
    if (next.toString() !== query) setParams(next, { replace: true });
  }, [context, query, setParams, userId]);
  return [context, (patch: Partial<PrepContext>) => setContext((previous) => cleanPrepContext({ ...previous, ...patch }))] as const;
}

export function clearPrepContext(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(KEY)) sessionStorage.removeItem(k);
    }
  } catch { /* Nothing persisted. */ }
}
