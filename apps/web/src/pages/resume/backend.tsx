import { createContext, useContext } from "react";
import type { Resume, ResumeInput } from "@orbit/types";
import { api } from "../../lib/api";
import { createSaveQueue, type SaveQueue } from "./saveQueue";

/** Where the editor reads and writes the resume, and the API its tools (score, AI, Word) call: the account. */
export interface ResumeBackend {
  tools: typeof api;
  get: (id: string) => Promise<Resume>;
  /** One save. `baseRevision`: the revision the text was based on; the server refuses (409) if another landed since. */
  save: (id: string, input: ResumeInput, baseRevision?: number) => Promise<{ revision: number }>;
}

export const accountBackend: ResumeBackend = {
  tools: api,
  get: (id) => api.getResume(id),
  save: async (id, input, baseRevision) => {
    const saved = await api.updateResume(id, baseRevision === undefined ? input : { ...input, base_revision: baseRevision });
    return { revision: saved.revision ?? 0 };
  },
};

// One save queue per backend, outliving any one editor: the save an editor starts as it closes and the one the
// next editor starts for the same resume still go one after the other (saveQueue.ts).
const queues = new WeakMap<ResumeBackend, SaveQueue<ResumeInput>>();
export function saveQueueFor(backend: ResumeBackend): SaveQueue<ResumeInput> {
  let q = queues.get(backend);
  if (!q) {
    q = createSaveQueue<ResumeInput>((id, input, base) => backend.save(id, input, base));
    queues.set(backend, q);
  }
  return q;
}

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
