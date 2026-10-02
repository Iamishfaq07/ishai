import { createContext, useContext } from "react";
import type { Resume, ResumeInput } from "@orbit/types";
import { api } from "../../lib/api";
import { newId } from "./model";

/**
 * Where the editor reads and writes the resume, and which API its tools (score, AI, Word) call. Signed in, that's the
 * account: resumes live on the server. Signed out (the free resume maker), the one resume lives in this browser and
 * the tools use the no-account API, so nothing about the person reaches the server.
 */
export interface ResumeBackend {
  guest: boolean;
  tools: typeof api.guest;
  get: (id: string) => Promise<Resume>;
  save: (id: string, input: ResumeInput) => Promise<unknown>;
  /** Signed out only: throw this resume away and start another. */
  startOver?: () => void;
}

export const accountBackend: ResumeBackend = {
  guest: false,
  tools: api,
  get: (id) => api.getResume(id),
  save: (id, input) => api.updateResume(id, input),
};

// ---- the signed-out resume: one, kept in this browser ---------------------------------------------------------

const KEY = "orbit.guest-resume.v1";

function read(): Resume | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    const r = raw ? (JSON.parse(raw) as Resume) : null;
    return r && typeof r === "object" && r.data && r.design ? r : null;
  } catch {
    return null;
  }
}

export const guestResume = {
  load: read,
  /** Whether there's a resume worth keeping: one with a name or any experience. */
  has: (): boolean => read() !== null,
  create(input: ResumeInput): Resume {
    const now = new Date().toISOString();
    const r: Resume = { ...input, cover_letter: input.cover_letter ?? "", id: newId(), created_at: now, updated_at: now };
    guestResume.write(r);
    return r;
  },
  write(r: Resume): void {
    // Private windows and full storage throw: the editor shows "Not saved" and the person can still download.
    window.localStorage.setItem(KEY, JSON.stringify(r));
  },
  clear(): void {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

export function guestBackend(startOver: () => void): ResumeBackend {
  return {
    guest: true,
    tools: api.guest,
    get: async () => {
      const r = read();
      if (!r) throw new Error("There's no resume on this device yet.");
      return r;
    },
    save: async (_id, input) => {
      const current = read();
      if (!current) return;
      guestResume.write({ ...current, ...input, cover_letter: input.cover_letter ?? current.cover_letter, updated_at: new Date().toISOString() });
    },
    startOver,
  };
}

export const BackendContext = createContext<ResumeBackend>(accountBackend);
export const useBackend = (): ResumeBackend => useContext(BackendContext);
