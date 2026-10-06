import type {
  CreateTextDocumentRequest,
  DocumentText,
  MockConfig,
  OrbitDocument,
  ResumeInterviewQuestion,
  ResumeQuestionsResponse,
  ResumeSkillGap,
  StoryInput,
  UpdateDocumentRequest,
} from "@orbit/types";

/**
 * Interview prep from the resume maker, connected to the rest of Orbit: the questions picked for a mock interview (a
 * drill of "prep" questions, MockConfig.drill), the documents that round reads (the resume and its job post, kept up
 * to date rather than copied), a behavioural answer saved to the story bank, and plain text to copy.
 */

/** A mock drill asks at most this many fixed questions (MockConfig.drill's max_length in mock_interviewer.py). */
export const MAX_PRACTICE = 8;

type Prep = Pick<ResumeQuestionsResponse, "groups" | "questions">;
type Drill = NonNullable<MockConfig["drill"]>;

/**
 * The questions ticked for practice at first: up to `max`, each group's first question, then each one's second, and
 * so on, so a short mock round covers every role and project instead of only the most recent.
 */
export function defaultPractice(prep: Prep, max = MAX_PRACTICE): string[] {
  const byGroup = prep.groups.map((g) => prep.questions.filter((q) => q.group === g.id));
  const out: string[] = [];
  for (let round = 0; out.length < max && byGroup.some((qs) => qs.length > round); round++) {
    for (const qs of byGroup) {
      const q = qs[round];
      if (q && out.length < max) out.push(q.id);
    }
  }
  return out;
}

/**
 * The mock interview's plan for the picked questions, in the order they're listed: each asked as written, and one
 * with a "be ready to defend" note followed up live where that note says the interviewer would push.
 */
export function practiceDrill(questions: readonly ResumeInterviewQuestion[], picked: Iterable<string>): Drill {
  const ids = new Set(picked);
  return questions
    .filter((q) => ids.has(q.id))
    .slice(0, MAX_PRACTICE)
    .map((q) => {
      const defend = q.defend.trim().slice(0, 400);
      return { question: q.question.slice(0, 400), kind: "prep" as const, follow_up: Boolean(defend), ...(defend ? { feedback: defend } : {}) };
    });
}

/** About four minutes a question with its follow-up, from 10 to 60 (the API takes 5–60). */
export function practiceMinutes(count: number): number {
  return Math.min(60, Math.max(10, count * 4));
}

/** One question as plain text: the question, its outline, what to add, what to defend. */
export function questionText(q: ResumeInterviewQuestion): string {
  const lines = [q.question];
  for (const p of q.outline) lines.push(`- ${p.label ? `${p.label}: ` : ""}${p.text}`);
  for (const m of q.missing) lines.push(`- ${m}`);
  if (q.defend) lines.push(`Be ready to defend: ${q.defend}`);
  return lines.join("\n");
}

/** The questions as plain text under their role or project headings; `group` keeps just that one. */
export function prepText(prep: Prep, group?: string): string {
  return prep.groups
    .filter((g) => !group || g.id === group)
    .map((g) => {
      const qs = prep.questions.filter((q) => q.group === g.id);
      return qs.length ? [g.label, ...qs.map((q, i) => `${i + 1}. ${questionText(q)}`)].join("\n\n") : "";
    })
    .filter(Boolean)
    .join("\n\n\n");
}

const VERDICT_TEXT = { related: "you have related experience", prepare: "prepare", dont_claim: "don't claim it" } as const;

/** The skill gap as plain text, one line per skill. */
export function skillGapText(gaps: readonly ResumeSkillGap[]): string {
  return gaps
    .map((g) => {
      const detail =
        g.verdict === "related"
          ? `Say it like: "${g.say}"${g.prepare ? ` To prepare: ${g.prepare}` : ""}`
          : g.verdict === "prepare"
            ? g.prepare
            : g.note;
      return `- ${g.skill}: ${VERDICT_TEXT[g.verdict]}. ${detail}`.trim();
    })
    .join("\n");
}

/**
 * A behavioural question's outline as a story-bank draft: its four parts, with a part the resume doesn't give left
 * as a [prompt] (the Stories page highlights those to fill in). null when there's no story to tell: not behavioural,
 * or nothing about what happened beyond prompts.
 */
export function storyFromQuestion(q: ResumeInterviewQuestion): StoryInput | null {
  if (q.type !== "behavioral") return null;
  const part = (label: string): string => {
    const p = q.outline.find((x) => x.label === label);
    return !p ? "" : p.ask ? `[${p.text}]` : p.text;
  };
  if (!q.outline.some((p) => !p.ask && (p.label === "Situation" || p.label === "Action"))) return null;
  const title = q.example.trim() || (q.question.length > 160 ? `${q.question.slice(0, 159).trimEnd()}…` : q.question);
  return { title, situation: part("Situation"), task: part("Task"), action: part("Action"), result: part("Result"), competencies: [] };
}

/** What a practice round needs from the documents API (the shared client has all four). */
export interface PracticeDocumentsApi {
  listDocuments(): Promise<OrbitDocument[]>;
  createTextDocument(req: CreateTextDocumentRequest): Promise<OrbitDocument>;
  getDocumentText(id: string): Promise<DocumentText>;
  updateDocument(id: string, req: UpdateDocumentRequest): Promise<OrbitDocument>;
}

/** The title of the job post's document for a resume: the same each time, so practising again updates it. */
export function jobPostTitle(resumeTitle: string): string {
  return `Job post for ${resumeTitle.trim() || "my resume"}`.slice(0, 300);
}

/** A pasted (not uploaded) document of this kind and title that can still be used. */
export function pastedDocument(docs: readonly OrbitDocument[], kind: OrbitDocument["kind"], title: string): OrbitDocument | undefined {
  return docs.find((d) => d.kind === kind && !d.filename && d.title === title && d.status !== "failed");
}

/**
 * The documents a practice round reads, so the AI interviewer's follow-ups come from this resume and job post: the
 * resume as "Use in Orbit" saves it (kind "resume", the resume's title) and the job post. A document already there
 * is brought up to date, not copied; one that can't be edited is left alone and a new one made. Returns their ids,
 * the job post first (as practiceDocumentIds orders them).
 */
export async function practiceDocuments(
  api: PracticeDocumentsApi,
  { title, resumeText, jobText }: { title: string; resumeText: string; jobText: string },
): Promise<string[]> {
  const docs = await api.listDocuments();
  const keep = async (kind: OrbitDocument["kind"], name: string, text: string): Promise<string> => {
    const have = pastedDocument(docs, kind, name);
    if (have) {
      const now = await api.getDocumentText(have.id);
      if (now.editable) {
        if (now.text !== text) await api.updateDocument(have.id, { text });
        return have.id;
      }
    }
    return (await api.createTextDocument({ kind, title: name, text })).id;
  };
  const resumeTitle = title.trim() || "Untitled resume";
  const resume = await keep("resume", resumeTitle, resumeText);
  // The API needs 20 characters at least; a post that short has nothing to ground follow-ups in anyway.
  const job = jobText.trim().length >= 40 ? await keep("job_description", jobPostTitle(resumeTitle), jobText.trim()) : null;
  return job ? [job, resume] : [resume];
}
