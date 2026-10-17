import { describe, expect, it } from "vitest";
import type { CreateTextDocumentRequest, OrbitDocument, ResumeInterviewQuestion, ResumePrepGroup, UpdateDocumentRequest } from "@orbit/types";
import {
  MAX_PRACTICE,
  defaultPractice,
  jobPostTitle,
  practiceDocuments,
  practiceDrill,
  practiceMinutes,
  prepText,
  skillGapText,
  storyFromQuestion,
} from "./resumePrep";

const q = (id: string, group: string, extra: Partial<ResumeInterviewQuestion> = {}): ResumeInterviewQuestion => ({
  id,
  group,
  question: `Question ${id}?`,
  type: "technical",
  outline: [{ label: "", text: `Fact ${id}`, ask: false }],
  missing: [],
  defend: "",
  example: "",
  ...extra,
});
const groups: ResumePrepGroup[] = [
  { id: "r1", kind: "role", label: "Senior Engineer at PayCo" },
  { id: "r2", kind: "role", label: "Engineer at Shop Inc" },
  { id: "job", kind: "job", label: "From the job post" },
];

describe("practising resume questions in a mock interview", () => {
  it("ticks each role's first question, then each one's second, up to the drill's limit", () => {
    const questions = [q("a", "r1"), q("b", "r1"), q("c", "r1"), q("d", "r2"), q("e", "job"), q("f", "job")];
    expect(defaultPractice({ groups, questions })).toEqual(["a", "d", "e", "b", "f", "c"]);
    expect(defaultPractice({ groups, questions }, 4)).toEqual(["a", "d", "e", "b"]);
    const many = Array.from({ length: 12 }, (_, i) => q(`x${i}`, "r1"));
    expect(defaultPractice({ groups, questions: many })).toHaveLength(MAX_PRACTICE);
  });

  it("asks the picked questions in list order, following up where there's something to defend", () => {
    const questions = [q("a", "r1", { defend: "  Know the baseline.  " }), q("b", "r1"), q("c", "r2", { question: "x".repeat(500) })];
    expect(practiceDrill(questions, ["c", "a"])).toEqual([
      { question: "Question a?", kind: "prep", follow_up: true, feedback: "Know the baseline." },
      { question: "x".repeat(400), kind: "prep", follow_up: false },
    ]);
    const many = Array.from({ length: 12 }, (_, i) => q(`x${i}`, "r1"));
    expect(practiceDrill(many, many.map((x) => x.id))).toHaveLength(MAX_PRACTICE);
    expect([1, 3, 8, 20].map(practiceMinutes)).toEqual([10, 12, 32, 60]);
  });
});

describe("saving and copying", () => {
  const story = q("s", "r1", {
    type: "behavioral",
    question: "Walk me through the ledger migration.",
    example: "Ledger migration to event sourcing",
    outline: [
      { label: "Situation", text: "Reconciliation took hours at PayCo", ask: false },
      { label: "Task", text: "Add what you were asked to do", ask: true },
      { label: "Action", text: "Moved the ledger to event sourcing on Kafka", ask: false },
      { label: "Result", text: "Add the result you got", ask: true },
    ],
  });

  it("turns a behavioural outline into a story, the parts to fill in left as [prompts]", () => {
    expect(storyFromQuestion(story)).toEqual({
      title: "Ledger migration to event sourcing",
      situation: "Reconciliation took hours at PayCo",
      task: "[Add what you were asked to do]",
      action: "Moved the ledger to event sourcing on Kafka",
      result: "[Add the result you got]",
      competencies: [],
    });
    expect(storyFromQuestion(q("t", "r1"))).toBeNull(); // not behavioural
    const empty = { ...story, outline: story.outline.map((p) => ({ ...p, ask: true })) };
    expect(storyFromQuestion(empty)).toBeNull(); // nothing to tell but prompts
    expect(storyFromQuestion({ ...story, example: "", question: "y".repeat(200) })?.title).toHaveLength(160);
  });

  it("copies the questions under their headings, and the skill gap line by line", () => {
    const text = prepText({ groups, questions: [story, q("j", "job", { defend: "Say it plainly.", missing: ["Add the tool"] })] });
    expect(text).toContain("Senior Engineer at PayCo\n\n1. Walk me through the ledger migration.\n- Situation: Reconciliation took hours at PayCo");
    expect(text).toContain("From the job post\n\n1. Question j?\n- Fact j\n- Add the tool\nBe ready to defend: Say it plainly.");
    expect(text).not.toContain("Engineer at Shop Inc"); // no questions there
    expect(prepText({ groups, questions: [story] }, "job")).toBe("");
    expect(
      skillGapText([
        { skill: "RDS", keyword: true, verdict: "related", evidence: "Ran PostgreSQL", say: "I run PostgreSQL.", prepare: "", note: "" },
        { skill: "gRPC", keyword: true, verdict: "prepare", evidence: "", say: "", prepare: "Build one endpoint.", note: "" },
        { skill: "PCI DSS", keyword: false, verdict: "dont_claim", evidence: "", say: "", prepare: "", note: "Say you haven't." },
      ]),
    ).toBe('- RDS: you have related experience. Say it like: "I run PostgreSQL."\n- gRPC: prepare. Build one endpoint.\n- PCI DSS: don\'t claim it. Say you haven\'t.');
  });
});

describe("the documents a practice round reads", () => {
  const doc = (id: string, kind: OrbitDocument["kind"], title: string, filename: string | null = null): OrbitDocument => ({
    id,
    title,
    kind,
    filename,
    size_bytes: 1,
    status: "ready",
    chunk_count: 1,
    created_at: "2026-10-01T00:00:00Z",
  });
  const fake = (docs: OrbitDocument[], texts: Record<string, { text: string; editable?: boolean }>) => {
    const calls: string[] = [];
    let n = 0;
    return {
      calls,
      listDocuments: async () => docs,
      createTextDocument: async (req: CreateTextDocumentRequest) => {
        calls.push(`create ${req.kind} ${req.title}${req.origin ? ` (${req.origin})` : ""}`);
        return doc(`new${++n}`, req.kind, req.title);
      },
      getDocumentText: async (id: string) => ({ id, title: "", kind: "resume" as const, editable: texts[id]?.editable ?? true, text: texts[id]?.text ?? "" }),
      updateDocument: async (id: string, req: UpdateDocumentRequest) => {
        calls.push(`update ${id}`);
        return doc(id, "resume", req.title ?? "");
      },
    };
  };
  const job = "Senior Backend Engineer. Python, PostgreSQL and Kafka on AWS.";

  it("makes the resume and the job post documents the first time, job post first, as Orbit's (outside the plan)", async () => {
    const api = fake([], {});
    expect(await practiceDocuments(api, { title: "Sam's CV", resumeText: "SAM LEE\nEXPERIENCE", jobText: job })).toEqual(["new2", "new1"]);
    expect(api.calls).toEqual(["create resume Sam's CV (orbit)", `create job_description ${jobPostTitle("Sam's CV")} (orbit)`]);
  });

  it("brings the documents it made before up to date instead of copying them", async () => {
    const docs = [doc("cv", "resume", "Sam's CV"), doc("upload", "resume", "Sam's CV", "cv.pdf"), doc("jd", "job_description", jobPostTitle("Sam's CV"))];
    const api = fake(docs, { cv: { text: "old text" }, jd: { text: job } });
    expect(await practiceDocuments(api, { title: "Sam's CV", resumeText: "new text", jobText: job })).toEqual(["jd", "cv"]);
    expect(api.calls).toEqual(["update cv"]); // the job post hasn't changed; the uploaded file is never touched
  });

  it("leaves a document it can't edit alone, and skips a job post too short to use", async () => {
    const api = fake([doc("cv", "resume", "Sam's CV")], { cv: { text: "", editable: false } });
    expect(await practiceDocuments(api, { title: "Sam's CV", resumeText: "text", jobText: "Engineer" })).toEqual(["new1"]);
    expect(api.calls).toEqual(["create resume Sam's CV (orbit)"]);
  });
});
