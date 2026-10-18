import type {
  ApplyBankItem,
  ApplyGroup,
  ApplyPacketDetail,
  ApplyPacketSummary,
  ApplyPlanReport,
  ApplySetup,
  ApplySetupInput,
  ApplyStatus,
} from "@orbit/types";
import { api } from "../../../lib/api";

/**
 * Orbit Apply's calls (`/v1/apply/...`, docs/PROTOCOL.md), kept in its own lazy chunk through the client's generic
 * `request`, so they don't add to every page's first download.
 */
const enc = encodeURIComponent;
const post = <T>(path: string, body?: unknown) =>
  api.request<T>(path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const put = <T>(path: string, body: unknown) => api.request<T>(path, { method: "PUT", body: JSON.stringify(body) });

export const applyApi = {
  getApplySetup: () => api.request<ApplySetup>("/v1/apply/setup"),
  saveApplySetup: (input: ApplySetupInput) => put<ApplySetup>("/v1/apply/setup", input),
  getApplyBank: () => api.request<ApplyBankItem[]>("/v1/apply/bank"),
  saveApplyBank: (items: Array<{ norm: string; value: string; label?: string }>) => put<ApplyBankItem[]>("/v1/apply/bank", items),
  /** Planning reads forms and writes letters: it can take a while. */
  planApplications: () => api.request<ApplyPlanReport>("/v1/apply/plan", { method: "POST", timeoutMs: 120_000 }),
  applyPackets: (group?: ApplyGroup) =>
    api.request<ApplyPacketSummary[]>(`/v1/apply/packets${group ? `?group=${enc(group)}` : ""}`),
  applyPacket: (id: string) => api.request<ApplyPacketDetail>(`/v1/apply/packets/${enc(id)}`),
  answerApplyPacket: (id: string, answers: Array<{ question_id: string | null; label: string; value: string }>) =>
    post<ApplyPacketDetail>(`/v1/apply/packets/${enc(id)}/answers`, { answers }),
  approveApplyPacket: (id: string) => post<ApplyPacketDetail>(`/v1/apply/packets/${enc(id)}/approve`),
  dontApplyPacket: (id: string) => post<ApplyPacketDetail>(`/v1/apply/packets/${enc(id)}/dont-apply`),
  retryApplyPacket: (id: string) => post<ApplyPacketDetail>(`/v1/apply/packets/${enc(id)}/retry`),
  doneApplyPacket: (id: string) => post<ApplyPacketDetail>(`/v1/apply/packets/${enc(id)}/done`),
  pauseApply: () => post<{ paused: boolean }>("/v1/apply/pause"),
  resumeApply: () => post<{ paused: boolean }>("/v1/apply/resume"),
  applyStatus: () => api.request<ApplyStatus>("/v1/apply/status"),
  /** A packet's screenshot or resume PDF (API-relative paths from the packet), fetched with the session. */
  applyFile: (path: string) => api.blob(path),
};
