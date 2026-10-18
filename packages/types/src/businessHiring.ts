/** Business Hiring Studio. Human observations stay separate from resume-match suggestions. */
export interface BizInterviewCriterion {
  id: string; name: string; stage_id: string; question: string; probe: string;
  strong: string; weak: string; minutes: number;
}
export interface BizWorkSampleSpec {
  title: string; brief: string; change_request: string; time_box_min: number;
  required: boolean; candidate_guidance: string;
}
export interface BizHiringPlan {
  criteria: BizInterviewCriterion[]; independent_feedback: boolean; candidate_intro: string;
  work_sample: BizWorkSampleSpec | null; response_target_days: number;
}
export interface BizHiringPlanRecord {
  job_id: string; revision: number; plan: BizHiringPlan; updated_at: string | null;
}
export interface BizEvidenceRating {
  criterion_id: string; score: 1 | 2 | 3 | 4 | null; observation: string;
  source: "interview" | "resume" | "work_sample"; quote: string;
}
export interface BizFeedbackContent {
  ratings: BizEvidenceRating[]; recommendation: "hire" | "hold" | "no_hire"; summary: string;
}
export interface BizInterviewFeedback {
  id: string; stage_id: string; author_id: string; author: string; mine: boolean;
  revision: number; plan_revision: number; plan_snapshot: BizHiringPlan;
  content: BizFeedbackContent; submitted_at: string | null; updated_at: string;
}
export interface BizSampleSubmission {
  response: string; explanation: string; assistance: "none" | "documentation" | "ai" | "collaboration";
}
export interface BizWorkSample {
  revision: number; plan_revision: number; brief: Omit<BizWorkSampleSpec, "change_request">;
  answer: BizSampleSubmission | null; follow_up: BizSampleSubmission | null; change_request: string | null;
  submitted_at: string | null; completed_at: string | null;
}
export interface BizEvidenceCoverage {
  criterion_id: string; name: string; assessed: boolean; spread: number;
  observations: Array<{ author: string; score: number; observation: string; source: string; plan_revision: number }>;
}
export interface BizHiringEvidence {
  criterion_id: string; name: string; status: string; quote: string; source_start: number | null;
  probe: string; question: string;
}
export interface BizHiringDecision {
  id: string; actor: string | null; created_at: string; outcome: "advance" | "hold" | "hire" | "no_hire";
  rationale: string; evidence_version: string; acknowledged_gaps: string[];
}
export interface BizHiringRoom {
  application_id: string; reference: string; name: string; job_id: string; job_title: string;
  stage_id: string; status: string; plan: BizHiringPlanRecord; evidence: BizHiringEvidence[];
  feedback_stage_id: string;
  feedback: BizInterviewFeedback[]; feedback_locked: boolean; pending_reviewers: number; expected_reviewers: number;
  coverage: BizEvidenceCoverage[]; gaps: string[]; evidence_version: string; work_sample: BizWorkSample | null;
  decisions: BizHiringDecision[]; candidate_questions: Array<{ id: string; message: string; created_at: string }>;
}
export interface BizInterviewBrief {
  intro: string; areas: string[]; stages: Array<{ name: string; minutes: number }>;
}
export interface BizCandidateSample {
  sample: BizWorkSample | null; accepting: boolean; interview_brief: BizInterviewBrief | null;
}
export interface BizHiringCompare {
  job_id: string; job_title: string;
  people: Array<Pick<BizHiringRoom, "application_id" | "name" | "reference" | "coverage" | "gaps" | "evidence">>;
}
export interface BizHiringDesk {
  as_of: string; limited: boolean;
  attention: Array<{ application_id: string; reference: string; name: string; job_title: string;
    reason: string; priority: "urgent" | "waiting"; hours: number }>;
  upcoming: BizHiringDeskInterview[]; feedback_due: BizHiringDeskInterview[];
}
export interface BizHiringDeskInterview {
  application_id: string; reference: string; name: string; job_title: string; when: string;
  duration_min: number; location: string;
}
