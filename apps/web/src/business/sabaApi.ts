import { api } from "../lib/api";

export interface SabaState {
  invited: boolean; started?: boolean; id?: string; status?: string; revision?: number; total?: number;
  notice?: string; notice_version?: string; introduction?: string; prompt?: string | null; expires_at?: string;
  transcript?: Array<{ id: string; question: string; answer: string; criterion: string; created_at: string }>;
  network_countries?: string[]; network_shared?: boolean;
  network_check_available?: boolean;
  network_check?: { status: string; provider: string; is_vpn?: boolean; is_proxy?: boolean; is_tor?: boolean; is_relay?: boolean; created_at: string } | null;
  explanations?: Array<{ id: string; message: string; created_at: string }>;
  alternative?: string | null;
  integrity_review?: { disposition: string; message: string; created_at: string; outdated: boolean } | null;
  review?: { items: Array<{ turn_a: string; quote_a: string; turn_b: string; quote_b: string; question: string }> } | null;
}
export interface OfferSummary {
  id: string; role: string; compensation: string; start_date: string; terms: string;
  status: string; revision: number; expires_at: string; created_at: string; responded_at: string | null;
}
const e = encodeURIComponent;
export const staffBase = (cid: string, aid: string) => `/v1/business/companies/${e(cid)}/applications/${e(aid)}`;
export const candidateBase = (token: string) => `/v1/public/business/applications/${e(token)}`;
export const cycleApi = {
  saba: (base: string) => api.call<SabaState>(`${base}/saba`),
  action: (base: string, action: string, body: object = {}) => api.call<SabaState>(`${base}/saba/${action}`, {
    method: "POST", body: JSON.stringify(body),
  }),
  offer: (base: string) => api.call<{ offer: OfferSummary | null }>(`${base}/offer`),
  offerAction: (base: string, action: string, body: object) => api.call<{ offer: OfferSummary | null }>(
    `${base}/offer${action ? `/${action}` : ""}`, { method: "POST", body: JSON.stringify(body) }),
};
