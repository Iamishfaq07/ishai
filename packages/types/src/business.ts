/**
 * Orbit for Business (D82): REST DTOs for /v1/business, /v1/public/business and /v1/admin/business. Mirrors the
 * FastAPI response models in apps/api/orbit_api/business. A company workspace is its own tenant: nothing here ever
 * carries a candidate's own Orbit data (copilot, practice, LinkedIn AI, documents, sessions), only what an applicant
 * shared with that company when they applied.
 */

// ─── Companies, members, plans ───────────────────────────────────────────────

export type BizRole = "owner" | "admin" | "recruiter" | "hiring_manager" | "interviewer";
export type BizPlan = "free" | "starter" | "growth";
export type BizCompanySize = "1-10" | "11-50" | "51-200" | "201-1000" | "1000+";
export type BizCompanyStatus = "active" | "suspended";

/** What a role may do (the API decides; the UI only hides what would be refused). */
export interface BizPermissions {
  manage_company: boolean; // profile, logo, settings, templates, retention, blind review
  manage_members: boolean; // invite, remove, change roles
  manage_plan: boolean; // owner only
  manage_jobs: boolean; // create, edit, publish, pause, close
  all_jobs: boolean; // false: only the jobs whose hiring team they are on
  move_applicants: boolean; // stages, reject, tags, emails, scheduling
  delete_applicants: boolean; // delete-on-request, export
  view_audit: boolean;
  scorecards_only: boolean; // interviewer: notes and scorecards on assigned applicants only
}

export interface BizCompanySummary {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  role: BizRole;
  verified: boolean;
  status: BizCompanyStatus;
  plan: BizPlan;
}

export interface BizInviteSummary {
  id: string;
  company_name: string;
  role: BizRole;
  invited_by: string | null;
  expires_at: string;
}

/** GET /v1/business/me */
export interface BizMe {
  companies: BizCompanySummary[];
  /** Invites waiting for this account's email address. */
  invites: BizInviteSummary[];
}

export interface BizCompany {
  id: string;
  slug: string;
  name: string;
  website: string;
  /** The website's domain ("acme.com"): what a work email or DNS record must prove. */
  domain: string;
  logo_url: string | null;
  size: BizCompanySize;
  country: string; // ISO 3166-1 alpha-2
  about: string;
  status: BizCompanyStatus;
  suspended_reason: string | null;
  verified: boolean;
  verified_at: string | null;
  verification_method: "email" | "dns" | "admin" | null;
  plan: BizPlan;
  plan_until: string | null;
  /** Months a rejected applicant's data is kept (default 12). */
  retention_months: number;
  /** Hide applicants' names, photos and contact details in the pipeline. */
  blind_review: boolean;
  careers_url: string;
  created_at: string;
  role: BizRole;
  permissions: BizPermissions;
}

/** POST /v1/business/companies */
export interface BizCompanyCreate {
  name: string;
  website: string;
  size: BizCompanySize;
  country: string;
  about?: string;
}

/** PATCH /v1/business/companies/{id} */
export interface BizCompanyUpdate {
  name?: string;
  website?: string; // changing the domain drops verification
  size?: BizCompanySize;
  country?: string;
  about?: string;
  retention_months?: number; // 1-48
  blind_review?: boolean;
}

/** GET /v1/business/companies/{id}/verification */
export interface BizVerification {
  verified: boolean;
  method: "email" | "dns" | "admin" | null;
  domain: string;
  /** The domain is a free-mail or hosting domain (gmail.com, sites.google.com…): it can't be verified. */
  blocked_domain: boolean;
  /** The signed-in member's own verified email is at the domain: one click verifies. */
  account_email_matches: boolean;
  dns: { type: "TXT"; host: string; value: string };
  /** A code was sent to this work email and is waiting (masked: "a***@acme.com"). */
  pending_email: string | null;
}

export interface BizMember {
  id: string;
  user_id: string;
  name: string | null;
  email: string;
  role: BizRole;
  joined_at: string;
  you: boolean;
}

export interface BizInvite {
  id: string;
  email: string;
  role: BizRole;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
}

/** GET /v1/business/companies/{id}/members */
export interface BizMembers {
  members: BizMember[];
  invites: BizInvite[];
  seats_used: number; // members + pending invites
  seats: number;
}

/** GET /v1/public/business/invites/{token} (signed out too) */
export interface BizInviteLookup {
  company_name: string;
  company_logo_url: string | null;
  role: BizRole;
  email_masked: string;
  expired: boolean;
  accepted: boolean;
}

export interface BizPlanInfo {
  id: BizPlan;
  label: string;
  jobs: number; // active (open or paused) jobs
  seats: number;
  price_inr: number; // per month; 0 for Free
  price_usd: number;
  invite_only: boolean;
}

/** GET /v1/business/companies/{id}/plan */
export interface BizPlanStatus {
  plan: BizPlan;
  plan_until: string | null;
  active_jobs: number;
  seats_used: number;
  limits: { jobs: number; seats: number };
  plans: BizPlanInfo[];
  /** Self-serve checkout isn't wired for company plans yet: an upgrade is a request the Orbit team grants. */
  checkout: "request";
  pending_request: { plan: BizPlan; created_at: string } | null;
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export type BizJobStatus = "draft" | "open" | "paused" | "closed";
export type BizWorkplace = "onsite" | "hybrid" | "remote";
export type BizEmploymentType = "full_time" | "part_time" | "contract" | "temporary" | "internship";
export type BizExperience = "entry" | "junior" | "mid" | "senior" | "lead";
export type BizSalaryPeriod = "year" | "month" | "hour";
export type BizStageKind = "applied" | "screen" | "interview" | "offer" | "hired" | "rejected";
export type BizQuestionKind = "yes_no" | "choice" | "short_text" | "number";

export interface BizStage {
  id: string;
  name: string;
  kind: BizStageKind;
}

/** A knock-out rule: an answer that fails it is flagged ("Doesn't meet: …") and sorted last. Never rejected
 *  automatically: a person clicks Reject. */
export interface BizKnockout {
  /** yes_no: the answer that passes ("yes" | "no"). choice: the choices that pass. number: min and/or max. */
  equals?: "yes" | "no";
  any_of?: string[];
  min?: number;
  max?: number;
}

export interface BizQuestion {
  id: string;
  text: string;
  kind: BizQuestionKind;
  choices?: string[]; // kind "choice"
  required: boolean;
  knockout?: BizKnockout | null;
}

export interface BizJobInput {
  title: string;
  /** Rich text: sanitized on the server (p, br, strong, em, u, ul, ol, li, h3, h4, a, blockquote). */
  description_html: string;
  department?: string;
  locations: string[]; // "Bengaluru, India"
  workplace: BizWorkplace;
  /** Remote: where applicants may live (ISO codes); [] = anywhere. */
  allowed_countries: string[];
  employment_type: BizEmploymentType;
  experience: BizExperience;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string; // ISO 4217, "INR"
  salary_period?: BizSalaryPeriod;
  show_salary: boolean;
  must_haves: string[];
  nice_to_haves: string[];
  questions: BizQuestion[];
  /** Editable per job; must keep at least one "applied" and one "rejected" stage. */
  stages?: BizStage[];
  /** User ids of members on the hiring team (hiring managers see only these jobs). */
  hiring_team?: string[];
  /** Closes itself after this date (validThrough); default 60 days after publishing. */
  valid_through?: string | null;
}

export interface BizJob extends Required<Omit<BizJobInput, "salary_min" | "salary_max" | "valid_through">> {
  id: string;
  company_id: string;
  slug: string;
  status: BizJobStatus;
  salary_min: number | null;
  salary_max: number | null;
  valid_through: string | null;
  published_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  public_url: string;
  /** Set by the Orbit team when they take a job down (job-scam protection). */
  taken_down_reason: string | null;
  counts: { applicants: number; new: number; by_stage: Record<string, number> };
}

export interface BizJobListItem {
  id: string;
  slug: string;
  title: string;
  status: BizJobStatus;
  department: string;
  locations: string[];
  workplace: BizWorkplace;
  published_at: string | null;
  updated_at: string;
  applicants: number;
  new_applicants: number;
  public_url: string;
}

/** POST /v1/business/companies/{id}/jobs/draft (the AI job-description writer) */
export interface BizJobBrief {
  title: string;
  seniority: string;
  location: string;
  employment_type: string;
  must_haves: string[];
  nice_to_haves: string[];
  about_company: string;
  notes: string;
  language: string; // "en"
}

export interface BizJobDraft {
  title: string;
  summary: string;
  responsibilities: string[];
  must_haves: string[];
  nice_to_haves: string[];
  description_markdown: string;
  /** The same, as sanitized HTML for the editor. */
  description_html: string;
  suggested_screening_questions: Array<{ text: string; kind: BizQuestionKind; choices?: string[] }>;
  /** Coded words the writer replaced, to show the recruiter. */
  inclusive_language_notes: string[];
  /** "template": the AI writer couldn't be reached, and this is the brief laid out. */
  source: "ai" | "template";
}

/** POST /v1/business/companies/{id}/jobs/assist (the job assistant, D85). A fill: `prompt` (and any quick fields
 *  or pasted text). A refine: `instruction` with `current` (the form as it is). Nothing is saved or published. */
export interface BizJobAssistInput {
  prompt: string;
  title?: string;
  location?: string;
  salary?: string;
  experience?: string;
  /** An old job post or notes. */
  pasted?: string;
  current?: BizJobAssistCurrent | null;
  instruction?: string;
  language?: "auto" | "en" | "hi";
}

export type BizJobAssistCurrent = Omit<BizJobInput, "hiring_team" | "valid_through">;

/** The parts of the editor an answer can change. "salary" is min, max, currency, period and show/hide together. */
export type BizAssistField =
  | "title"
  | "department"
  | "locations"
  | "workplace"
  | "allowed_countries"
  | "employment_type"
  | "experience"
  | "salary"
  | "description"
  | "must_haves"
  | "nice_to_haves"
  | "questions"
  | "stages";

export interface BizJobAssist {
  title: string;
  department: string;
  locations: string[];
  workplace: BizWorkplace;
  allowed_countries: string[];
  employment_type: BizEmploymentType;
  experience: BizExperience;
  /** Only ever the pay the recruiter wrote (never invented); null when they gave none. */
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_period: BizSalaryPeriod;
  show_salary: boolean;
  description_html: string;
  must_haves: string[];
  nice_to_haves: string[];
  questions: BizQuestion[];
  /** null: keep the job's stages. */
  stages: BizStage[] | null;
  /** What was assumed and why ("Assumed full-time because you didn't say"). */
  assumptions: string[];
  /** Wording changed, or input left out because it screened on a personal characteristic. */
  inclusive_language_notes: string[];
  /** The fields this answer changes: all those filled for a fill, only the affected ones for a refine. */
  changed_fields: BizAssistField[];
  /** "template": the AI couldn't be reached; this is what the words say, laid out. */
  source: "ai" | "template";
}

// ─── Applications (company side) ─────────────────────────────────────────────

export type BizApplicationState = "active" | "rejected" | "hired" | "withdrawn";
export type BizSource = "careers" | "widget" | "orbit" | "google" | "linkedin" | "direct" | "other";
export type BizMet = "yes" | "partly" | "no";

export interface BizRequirementMatch {
  requirement: string;
  met: BizMet;
  evidence: string | null;
}

export interface BizRanking {
  score: number; // 0-100
  must_haves: BizRequirementMatch[];
  nice_to_haves: BizRequirementMatch[];
  summary: string;
  cautions: string[];
  /** The model version is audit data (the company's audit log, the Orbit admin): never sent here. */
  ranked_at: string;
}

export interface BizApplicationListItem {
  id: string;
  /** "A-7F3K2Q": shown instead of the name in blind review. */
  reference: string;
  name: string; // "Candidate A-7F3K2Q" in blind review
  email: string | null; // null in blind review
  headline: string | null;
  stage_id: string;
  status: BizApplicationState;
  source: BizSource;
  tags: string[];
  applied_at: string;
  stage_changed_at: string;
  email_confirmed: boolean;
  /** Applied with one click from an Orbit account. */
  via_orbit: boolean;
  knockout_failed: boolean;
  knockout_reasons: string[];
  ranking_status: "pending" | "done" | "failed";
  score: number | null;
  must_haves_met: number | null;
  must_haves_total: number | null;
  /** "Matches 6/8 must-haves" */
  match_label: string | null;
  /** Keyword matching alone (the AI model was unavailable): shown as "basic match". */
  basic_match: boolean;
  deletion_requested: boolean;
}

/** GET /v1/business/companies/{cid}/jobs/{jid}/applications */
export interface BizApplicationList {
  job: { id: string; title: string; stages: BizStage[]; status: BizJobStatus };
  items: BizApplicationListItem[];
  blind: boolean;
}

export interface BizAnswer {
  question_id: string;
  question: string;
  answer: string;
  knockout_failed: boolean;
}

export interface BizNote {
  id: string;
  author: string;
  author_id: string | null;
  body: string;
  mentions: string[]; // user ids
  created_at: string;
}

export interface BizScoreItem {
  criterion: string;
  score: 1 | 2 | 3 | 4;
}

export interface BizScorecard {
  id: string;
  stage_id: string;
  author: string;
  author_id: string | null;
  ratings: BizScoreItem[];
  notes: string;
  recommendation: "hire" | "no_hire";
  created_at: string;
}

export interface BizTimelineEvent {
  id: string;
  kind:
    | "applied"
    | "email_confirmed"
    | "stage"
    | "rejected"
    | "unrejected"
    | "withdrawn"
    | "hired"
    | "note"
    | "scorecard"
    | "email"
    | "interview_slots"
    | "interview_booked"
    | "ranked"
    | "tags"
    | "deletion_requested"
    | "hiring_task_created"
    | "hiring_task_updated"
    | "interview_change_requested"
    | "interview_change_replied"
    | "interview_change_withdrawn"
    | "interview_change_closed";
  text: string;
  actor: string | null;
  created_at: string;
}

export interface BizInterviewSlots {
  id: string;
  slots: string[]; // ISO datetimes
  duration_min: number;
  location: string; // a video link or an address
  chosen: string | null;
  created_at: string;
}

/** GET /v1/business/companies/{cid}/applications/{aid} */
export interface BizApplicationDetail extends BizApplicationListItem {
  hiring_plan_revision?: number;
  job_id: string;
  job_title: string;
  phone: string | null;
  location: string | null;
  /** The resume as shared: plain text (uploads are read, not kept; one-click applies share the resume's text). */
  resume_text: string;
  resume_filename: string | null;
  resume_source: "upload" | "orbit_resume" | "orbit_document";
  parsed: {
    headline: string | null;
    total_years: number | null;
    skills: string[];
    experience: Array<{ title: string; company: string; start?: string | null; end?: string | null; summary: string }>;
    education: Array<{ degree: string; school: string; year?: string | null }>;
  } | null;
  answers: BizAnswer[];
  ranking: BizRanking | null;
  notes: BizNote[];
  scorecards: BizScorecard[];
  timeline: BizTimelineEvent[];
  interviewers: string[]; // user ids
  interview: BizInterviewSlots | null;
  consent: { notice_version: string; accepted_at: string };
}

export interface BizMoveRequest {
  ids: string[];
  stage_id: string;
  /** Send the "stage changed" email template (optional). */
  notify?: boolean;
}

export interface BizRejectRequest {
  ids: string[];
  send_email: boolean;
  /** Overrides the rejection template for this send. */
  subject?: string;
  body?: string;
}

/** POST .../applications/move and .../applications/reject */
export interface BizBulkResult {
  moved: number;
  items: BizApplicationListItem[];
  /** Emails not sent because those applicants haven't confirmed their email yet (company emails wait for that). */
  emails_waiting: number;
}

export interface BizScorecardInput {
  stage_id: string;
  ratings: BizScoreItem[];
  notes: string;
  recommendation: "hire" | "no_hire";
}

export interface BizSlotsInput {
  slots: string[]; // 3-5 ISO datetimes in the future
  duration_min: number; // 15-240
  location: string;
  message?: string;
}

// ─── Email templates ─────────────────────────────────────────────────────────

export type BizTemplateKind = "received" | "stage" | "rejection" | "interview";

export interface BizTemplate {
  kind: BizTemplateKind;
  subject: string;
  body: string;
  /** Still Orbit's default text. */
  is_default: boolean;
  /** {{candidate_name}}, {{job_title}}, {{company_name}}, {{stage}}, {{status_link}}, {{recruiter_name}} */
  variables: string[];
}

// ─── Notifications, audit, analytics ─────────────────────────────────────────

export interface BizNotification {
  id: string;
  company_id: string;
  company_name: string;
  kind: "mention" | "automation" | "scheduling";
  text: string;
  link: string; // an app path: /business/app/<cid>/applications/<aid>
  read: boolean;
  created_at: string;
}

export interface BizAuditEntry {
  id: string;
  actor: string | null;
  actor_id: string | null;
  action: string; // "application.moved", "application.rejected", "ranking.completed", "member.invited", …
  target: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface BizJobAnalytics {
  job_id: string;
  title: string;
  applicants: number;
  by_source: Record<string, number>;
  /** How many reached each stage (in the job's order), and as a share of applicants. */
  funnel: Array<{ stage_id: string; name: string; reached: number; rate: number }>;
  /** Hours from applying to the first human action (a move, an email, a rejection); null with none yet. */
  median_first_response_hours: number | null;
  responded: number;
}

export interface BizCompanyAnalytics {
  withdrawn: number;
  open_jobs: number;
  applicants_total: number;
  applicants_30d: number;
  hired: number;
  median_first_response_hours: number | null;
  by_source: Record<string, number>;
  jobs: BizJobAnalytics[];
  /** Applicants per day, last 30 days. */
  daily: Array<{ day: string; count: number }>;
}

// ─── Public (careers pages, applying, the candidate's status page) ──────────

export interface BizPublicJobSummary {
  id: string;
  slug: string;
  title: string;
  department: string;
  location_line: string; // "Bengaluru · Hybrid", "Remote (India)"
  employment_type: BizEmploymentType;
  published_at: string;
  url: string;
}

/** GET /v1/public/business/companies/{slug} */
export interface BizPublicCompany {
  slug: string;
  name: string;
  website: string;
  logo_url: string | null;
  about: string;
  country: string;
  verified: boolean;
  /** The domain the company proved, for the badge ("Verified: acme.com"); null while unverified. */
  verified_domain: string | null;
  jobs: BizPublicJobSummary[];
}

/** GET /v1/public/business/companies/{slug}/jobs/{jobSlug} */
export interface BizPublicJob {
  id: string;
  slug: string;
  status: "open" | "paused" | "closed";
  title: string;
  description_html: string;
  department: string;
  locations: string[];
  location_line: string;
  workplace: BizWorkplace;
  allowed_countries: string[];
  employment_type: BizEmploymentType;
  experience: BizExperience;
  salary: { min: number | null; max: number | null; currency: string; period: BizSalaryPeriod } | null;
  published_at: string | null;
  valid_through: string | null;
  questions: BizQuestion[]; // knock-out rules left out
  company: { slug: string; name: string; logo_url: string | null; website: string; verified: boolean; verified_domain: string | null };
  url: string;
  notice: { version: string; text: string };
  /** Google for Jobs JobPosting; null unless the job is open. */
  json_ld: Record<string, unknown> | null;
}

/** GET /v1/business/apply/{jobId}/preview?resume_id=|document_id= : exactly what one click shares. */
export interface BizApplyPreview {
  name: string;
  email: string;
  phone: string | null;
  resume_title: string;
  resume_text: string;
  resumes: Array<{ id: string; kind: "orbit_resume" | "orbit_document"; title: string; updated_at: string }>;
  already_applied: boolean;
}

export interface BizApplyAnswer {
  question_id: string;
  answer: string;
}

/** POST /v1/business/apply/{jobId} (signed in, one click) */
export interface BizOneClickApply {
  resume_id?: string | null;
  document_id?: string | null;
  phone?: string | null;
  answers: BizApplyAnswer[];
  consent: boolean;
  notice_version: string;
  source?: BizSource;
}

/** The answer to either apply. */
export interface BizApplyResult {
  status: "applied" | "already_applied";
  /** Signed out: check your inbox to confirm (and for the status link). Signed in: the status page link. */
  message: string;
  status_url: string | null;
  tracker_id: string | null;
}

/** GET /v1/public/business/applications/{token} : the candidate's status page */
export interface BizApplicationStatus {
  reference: string;
  application_state: BizApplicationState;
  can_withdraw: boolean;
  withdrawn_at: string | null;
  withdrawal_notice: string;
  withdrawal_notice_version: string;
  company: { name: string; logo_url: string | null; slug: string };
  job_title: string;
  job_url: string;
  /** In plain words: "Received", "Being reviewed", "Interviewing", "Offer", "Hired", "Not moving forward". */
  stage_label: string;
  stage_detail: string;
  applied_at: string;
  email_confirmed: boolean;
  interview: { slots: string[]; duration_min: number; location: string; chosen: string | null } | null;
  deletion_requested: boolean;
}

// ─── Orbit admin ─────────────────────────────────────────────────────────────

export interface BizAdminCompany {
  id: string;
  slug: string;
  name: string;
  website: string;
  domain: string;
  country: string;
  size: BizCompanySize;
  status: BizCompanyStatus;
  suspended_reason: string | null;
  verified: boolean;
  verification_method: string | null;
  plan: BizPlan;
  plan_until: string | null;
  owner_email: string | null;
  members: number;
  open_jobs: number;
  applicants: number;
  open_reports: number;
  pending_plan_request: BizPlan | null;
  created_at: string;
}

export interface BizAdminJob {
  id: string;
  title: string;
  status: BizJobStatus;
  taken_down_reason: string | null;
  public_url: string;
  published_at: string | null;
  applicants: number;
}

export interface BizAdminCompanyDetail extends BizAdminCompany {
  about: string;
  jobs: BizAdminJob[];
  reports: BizJobReport[];
}

export interface BizJobReport {
  id: string;
  job_id: string;
  job_title: string;
  company_id: string;
  company_name: string;
  reason: "scam" | "fake_company" | "discriminatory" | "misleading" | "other";
  details: string;
  status: "open" | "dismissed" | "actioned";
  created_at: string;
}
