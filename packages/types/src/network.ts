import type { JobContact, JobStatus } from "./api";

export interface NetworkPerson {
  source_id: string; name: string; title: string; email: string | null; linkedin_url: string | null; quote: string;
}
export interface NetworkSource {
  id: string; kind: "saved_posting" | "public_page" | "pasted_reply" | "search_snippet";
  url: string | null; text: string; checked_at: string;
}
export interface NetworkContext {
  version: string;
  job: { id: string; title: string; company: string };
  saved_contacts: JobContact[];
  company_history: {
    counts: Partial<Record<JobStatus, number>>; truncated: boolean; last_contacted_at: string | null;
    applications: Array<{ id: string; title: string; status: JobStatus; applied_at: string | null }>;
  };
  web_search_enabled: boolean;
  web_search_provider?: "searxng" | "brave" | null;
  search_links: Array<{ label: string; url: string }>;
}
export interface NetworkResearch {
  provider: string; warnings: string[]; people: NetworkPerson[]; sources: NetworkSource[];
}
export interface NetworkDraft {
  subject: string; message: string; provider: string; character_limit: number;
}
