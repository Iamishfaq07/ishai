import { createContext, useContext } from "react";
import type { Resume, ResumeInput } from "@orbit/types";
import { api } from "../../lib/api";

/** Where the editor reads and writes the resume, and the API its tools (score, AI, Word) call: the account. */
export interface ResumeBackend {
  tools: typeof api;
  get: (id: string) => Promise<Resume>;
  save: (id: string, input: ResumeInput) => Promise<unknown>;
}

export const accountBackend: ResumeBackend = {
  tools: api,
  get: (id) => api.getResume(id),
  save: (id, input) => api.updateResume(id, input),
};

// ---- a resume from the old signed-out resume maker, still in this browser --------------------------------------

const KEY = "orbit.guest-resume.v1";

/** The signed-out maker is gone, but a resume made there may still be on this device: the list offers to save it. */
export const guestResume = {
  load(): Resume | null {
    try {
      const raw = window.localStorage.getItem(KEY);
      const r = raw ? (JSON.parse(raw) as Resume) : null;
      return r && typeof r === "object" && r.data && r.design ? r : null;
    } catch {
      return null;
    }
  },
  clear(): void {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* nothing to clear */
    }
  },
};

export const BackendContext = createContext<ResumeBackend>(accountBackend);
export const useBackend = (): ResumeBackend => useContext(BackendContext);
