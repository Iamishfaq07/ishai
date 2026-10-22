import type { JobContact, JobStatus } from "./api";

export interface NetworkPerson {
  source_id: string; name: string; title: string; email: string | null; linkedin_url: string | null; quote: string;
}
export interface NetworkSource {
  id: string; kind: "saved_posting" | "public_page" | "pasted_reply" | "search_snippet" | "search_content";
  url: string | null; text: string; checked_at: string;
}
export interface NetworkContext {
  version: string;
  job_version?: string;
  job: { id: string; title: string; company: string };
  saved_contacts: JobContact[];
  company_history: {
    counts: Partial<Record<JobStatus, number>>; truncated: boolean; last_contacted_at: string | null;
    applications: Array<{ id: string; title: string; status: JobStatus; applied_at: string | null }>;
  };
  web_search_enabled: boolean;
  web_search_provider?: "searxng" | "brave" | "deepseek" | null;
  /** Configured services in the order a run tries them (absent on servers older than the fallback). */
  web_search_providers?: ("searxng" | "brave" | "deepseek")[];
  /** Why automatic search is off: no DeepSeek key, the mock AI provider, or DeepSeek search switched off. */
  web_search_off_reason?: "no_key" | "mock_mode" | "deepseek_off" | null;
  automatic_search_limit?: number;
  search_links: Array<{ label: string; url: string }>;
}
export interface NetworkResearch {
  provider: string; warnings: string[]; people: NetworkPerson[]; sources: NetworkSource[];
  job_version?: string;
  workflow?: Array<{ label: string; status: "completed" | "empty" | "failed"; source_count: number }>;
}
export interface NetworkDraft {
  subject: string; message: string; provider: string; character_limit: number;
}
