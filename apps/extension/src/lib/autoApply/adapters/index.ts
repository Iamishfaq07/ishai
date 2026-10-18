import type { Ats } from "../contract";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import type { Adapter } from "./types";

export const ADAPTERS: Record<Ats, Adapter> = { greenhouse, lever, ashby };

/** The only sites auto-apply opens, and the optional host permissions it asks for (build.mjs keeps them in step). */
export const ATS_HOSTS: Record<Ats, string[]> = { greenhouse: greenhouse.hosts, lever: lever.hosts, ashby: ashby.hosts };
export const ATS_ORIGINS = Object.values(ATS_HOSTS)
  .flat()
  .map((h) => `https://${h}/*`);

/** Whether a URL is an https page on the given ATS's own hosts (auto-apply never opens anything else). */
export function onAtsHost(url: string, ats: Ats): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ATS_HOSTS[ats].includes(u.hostname);
  } catch {
    return false;
  }
}

export type { Adapter };
