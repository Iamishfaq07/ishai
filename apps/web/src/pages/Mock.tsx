import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { MockDifficulty, MockInterviewType, MockPersona } from "@orbit/types";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select } from "../components/ui";
import { MOCK_INTERVIEW_ENABLED, Target } from "@orbit/ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { PrepSection } from "./Prep";
import { ProgressSection } from "./Progress";
import type { LiveLaunchState } from "./SessionSetup";

const TYPES: Array<{ value: MockInterviewType; label: string }> = [
  { value: "behavioral", label: "Behavioral" },
  { value: "technical", label: "Technical" },
  { value: "system_design", label: "System design" },
  { value: "coding", label: "Coding" },
  { value: "mixed", label: "Mixed" },
  { value: "negotiation", label: "Salary negotiation" },
];

/**
 * Mock interview: the AI plays interviewer (spoken with the browser's voice), you answer by voice.
 * Deliberately simple — setup here, the live screen does the rest.
 */
export function MockPage() {
  // The AI interviewer isn't built yet — show a coming-soon state instead of a form that dead-ends.
  if (!MOCK_INTERVIEW_ENABLED) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <PageHeader icon={Target} title="Mock interview" subtitle="Coming soon" />
        <p className="mt-4 text-sm text-zinc-500">
          The AI interviewer that asks you questions is still in the works. For now, start a normal session and
          use Orbit live, or practice by pasting questions into Chat.
        </p>
      </div>
    );
  }
  return <MockSetup />;
}

function MockSetup() {
  const navigate = useNavigate();
  const docs = useAsync(() => api.listDocuments(), [], "documents");
  const [role, setRole] = useState("");
  const [interviewType, setInterviewType] = useState<MockInterviewType>("mixed");
  const [difficulty, setDifficulty] = useState<MockDifficulty>("medium");
  const [duration, setDuration] = useState(20);
  const [persona, setPersona] = useState<MockPersona>("hiring_manager");
  const [offer, setOffer] = useState("");
  const [company, setCompany] = useState("");
  const [target, setTarget] = useState("");
  const negotiation = interviewType === "negotiation";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const contextDocs = (docs.data ?? [])
      .filter((d) => d.status === "ready" && (d.kind === "resume" || d.kind === "job_description"))
      .map((d) => d.id);
    try {
      const session = await api.createSession({
        title: negotiation
          ? `Negotiation — ${company.trim() || role.trim() || "offer"}`
          : `Mock — ${role.trim() || TYPES.find((t) => t.value === interviewType)?.label || "Interview"}`,
        type: "mock",
        ...(role.trim() ? { role: role.trim() } : {}),
        language: "en",
        length: "standard",
        style: "natural",
        auto_answer: false,
        document_ids: contextDocs,
        mock: {
          interview_type: interviewType,
          difficulty,
          duration_minutes: duration,
          persona: negotiation ? "recruiter" : persona,
          ...(negotiation
            ? {
                negotiation: {
                  offer: offer.trim(),
                  ...(company.trim() ? { company: company.trim() } : {}),
                  ...(target.trim() ? { target: target.trim() } : {}),
                },
              }
            : {}),
        },
      });
      const launch: LiveLaunchState = { systemAudio: false };
      navigate(`/live/${session.id}`, { state: launch });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader
        icon={Target}
        title="Practice"
        subtitle="Prep the likely questions for a job, then practise out loud with an AI interviewer."
      />
      <ProgressSection />
      <PrepSection docs={docs.data} onDocumentAdded={(d) => docs.setData((prev) => [d, ...(prev ?? [])])} />
      <section aria-labelledby="mock-title">
      <Card>
        <div className="mb-5">
          <h2 id="mock-title" className="font-display text-lg font-semibold">
            Mock interview
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Orbit asks, listens, follows up, and gives you a short report at the end.
          </p>
        </div>
        <form onSubmit={(e) => void start(e)} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role" htmlFor="mock-role">
              <Input id="mock-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Backend Engineer" />
            </Field>
            <Field label="Interview type" htmlFor="mock-type">
              <Select id="mock-type" value={interviewType} onChange={(e) => setInterviewType(e.target.value as MockInterviewType)}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            {negotiation ? (
              <Field label="Company" htmlFor="mock-company">
                <Input id="mock-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme" maxLength={120} />
              </Field>
            ) : (
              <Field label="Interviewer" htmlFor="mock-persona">
                <Select id="mock-persona" value={persona} onChange={(e) => setPersona(e.target.value as MockPersona)}>
                  <option value="recruiter">Recruiter</option>
                  <option value="hiring_manager">Hiring manager</option>
                  <option value="engineer">Senior engineer</option>
                  <option value="staff_engineer">Staff engineer</option>
                  <option value="executive">Executive</option>
                </Select>
              </Field>
            )}
            <Field label={negotiation ? "Recruiter" : "Difficulty"} htmlFor="mock-difficulty">
              <Select id="mock-difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value as MockDifficulty)}>
                <option value="easy">{negotiation ? "Flexible — has budget room" : "Easy"}</option>
                <option value="medium">{negotiation ? "Realistic — some room, pushes back" : "Medium"}</option>
                <option value="hard">{negotiation ? "Tough — tight budget, applies pressure" : "Hard"}</option>
              </Select>
            </Field>
            {negotiation && (
              <>
                <Field label="The offer" htmlFor="mock-offer" hint="What the recruiter presents, e.g. “$150,000 base, 10% bonus, 0.05% equity”.">
                  <Input id="mock-offer" required value={offer} onChange={(e) => setOffer(e.target.value)} maxLength={300} />
                </Field>
                <Field label="Your target (optional)" htmlFor="mock-target" hint="The recruiter doesn’t know it — your review uses it to judge how close you got.">
                  <Input id="mock-target" value={target} onChange={(e) => setTarget(e.target.value)} maxLength={300} placeholder="$170,000 base" />
                </Field>
              </>
            )}
            <Field label="Duration" htmlFor="mock-duration">
              <Select id="mock-duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[10, 20, 30, 45].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="text-xs text-zinc-500">
            {negotiation
              ? "The AI plays a recruiter who has just made you this offer. Negotiate out loud; your review grades how you anchored, justified and handled pushback. Only your microphone is used."
              : "Uses your ready resume and job descriptions for context. Only your microphone is used."}
          </p>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" disabled={busy || (negotiation && offer.trim().length < 2)}>
            {busy ? "Starting…" : negotiation ? "Start the negotiation" : "Start mock interview"}
          </Button>
        </form>
      </Card>
      </section>
    </div>
  );
}
