export interface BizTalentPool {
  id: string; name: string; purpose: string; retention_days: number; enabled: boolean; revision: number; terms_revision: number;
}
export interface BizTalentMember {
  id: string; name: string; application_id: string; skills: string[]; interests: string; expires_at: string; consented_at: string;
}
export interface BizTalentOwn {
  notice_version: string; notice: string;
  items: Array<BizTalentPool & { available: boolean; active: boolean; membership: { notice_version: string; notice_sha256: string; skills: string[]; interests: string; expires_at: string; consented_at: string } | null; suggestions: Array<{ id: string; title: string; href: string }> }>;
}
export interface BizTalentSuggestion { id: string; job_id: string; title: string; status: string }
export interface BizTalentSearch {
  id: string; name: string; query: string; revision: number; terms_revision: number; stale: boolean; can_manage: boolean;
}
