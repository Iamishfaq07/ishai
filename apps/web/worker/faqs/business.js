// /business: Orbit for Business's questions and answers, as the page shows them and its FAQPage markup states them
// (faqs.js, D79, D82). Describes shipped features only.

/** @type {ReadonlyArray<readonly [string, string]>} */
export const BUSINESS_FAQ = [
  [
    "What tools does Orbit for Business include?",
    "Alongside jobs and the shared applicant pipeline, Orbit includes hiring requests, hiring capacity, Workflow Studio, an independent review inbox, opt-in talent communities, Knowledge Studio, team reading, policy reviews, internal automation follow-ups and optional candidate process feedback. Your company role, plan and configured services determine availability.",
  ],
  [
    "Can I plan a rollout before creating an account?",
    "Yes. The Business page includes a rollout planner with four goals, suggested owners and completion criteria. Download a checklist without signing in. Checkmarks are session-only planning notes; they do not verify setup or change approvals. Signed-in teams can use the same planner from their company Business launchpad.",
  ],
  [
    "What can the Business AI tools help with?",
    "Depending on your configured provider and permissions, AI can draft jobs and workflow playbooks, prepare progress and capacity summaries, summarize qualifying process-feedback groups, and answer knowledge questions with exact source quotes. Outputs need human review. The rollout planner uses curated checklists and does not call a model.",
  ],
  [
    "How do you stop fake employers and job scams?",
    "A company can draft jobs right away, but it can publish them only after proving its domain: a work email at the company's own website, or a DNS record on it. Free email addresses can't verify a company. Anyone can report a job, and the Orbit team reviews reports and can take a job or a company down.",
  ],
  [
    "Does the AI reject applicants?",
    "No. Orbit ranks applicants against the job's must-haves and shows the evidence for each, and screening answers that miss a knock-out rule are flagged and sorted last. Rejecting always takes a person's click, and the audit log records who did it.",
  ],
  [
    "What does the ranking look at?",
    "Only professional information: the resume's skills, experience and education, and the screening answers. Names, photos, age, gender and other personal traits are never inputs, and blind review hides names and contact details from reviewers.",
  ],
  [
    "Will my jobs show on Google?",
    "Each open job has its own page on Orbit with Google for Jobs markup, listed in Orbit's sitemap. The markup is removed when the job closes or is paused, so Google isn't left with stale jobs.",
  ],
  [
    "Can job seekers on Orbit see my company's data, or can I see theirs?",
    "No. A company sees an applicant's information only for applications made to that company, and only what the applicant chose to share. Their practice, interview sessions, documents and other Orbit data are never shown to a company.",
  ],
  [
    "How long is applicants' data kept?",
    "Each company sets a retention period; by default a rejected applicant's data is deleted 12 months after the rejection. Applicants can ask for deletion from their status page, and you can delete an application or export a job's applicants at any time.",
  ],
];
