import type { PreflightCheck } from "@orbit/types";
import { PreflightPanel as SharedPreflightPanel } from "@orbit/ui";
import { getVersion } from "@tauri-apps/api/app";
import { API_URL, api } from "./api";

export interface LocalAudioState {
  micName: string | null; // null = no microphone found
  systemAudio: boolean;
  /** "Capturing: Microsoft Teams" / "Capturing: Speakers (Realtek)". */
  interviewerSource: string | null;
  hasResume: boolean;
  hasJobDescription: boolean;
}

function localChecks(s: LocalAudioState): PreflightCheck[] {
  const out: PreflightCheck[] = [];
  out.push(
    s.micName
      ? { id: "mic", label: "Microphone", status: "ok", detail: s.micName }
      : {
          id: "mic",
          label: "Microphone",
          status: "fail",
          severity: "blocker",
          detail: "No microphone found.",
          fix: "Plug one in, or allow microphone access in Windows Settings → Privacy & security → Microphone.",
        },
  );
  out.push(
    !s.systemAudio
      ? { id: "system", label: "Interviewer audio", status: "warn", detail: "Off — Orbit only hears your microphone.",
          fix: "Turn on interviewer audio below so Orbit can tell who's speaking." }
      : { id: "system", label: "Interviewer audio", status: "ok", detail: s.interviewerSource ?? "Default output" },
  );
  out.push(
    s.hasResume
      ? { id: "resume", label: "Resume", status: "ok", detail: "Selected." }
      : { id: "resume", label: "Resume", status: "warn", detail: "None selected.",
          fix: "Add or tick your resume below so answers use your real background." },
  );
  out.push(
    s.hasJobDescription
      ? { id: "jd", label: "Job description", status: "ok", detail: "Selected." }
      : { id: "jd", label: "Job description", status: "warn", detail: "None selected.",
          fix: "Optional: add the job description so answers fit the role." },
  );
  return out;
}

const appVersion = () => getVersion();

/** Pre-session checklist: the shared panel (packages/ui) with Windows' own audio and document checks. */
export function PreflightPanel({
  local,
  onStatus,
}: {
  local: LocalAudioState;
  onStatus?: (blockers: PreflightCheck[]) => void;
}) {
  return (
    <SharedPreflightPanel
      api={api}
      healthUrl={`${API_URL}/health`}
      local={localChecks(local)}
      appVersion={appVersion}
      {...(onStatus ? { onStatus } : {})}
    />
  );
}
