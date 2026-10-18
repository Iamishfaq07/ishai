import type { MockDifficulty, MockInterviewType, MockPersona, SessionType } from "@orbit/types";
import { Field, Input, Select, Spot, type SpotKind } from "@orbit/ui";
import { ChoiceTile } from "./tiles";

/** The six kinds of session, each with its picture (a spot) and what it does, in one line. */
export const SESSION_TYPES: Array<{ value: SessionType; label: string; line: string; spot: SpotKind }> = [
  { value: "interview", label: "Interview", line: "Live answers from your resume and the job post.", spot: "copilot" },
  { value: "coding", label: "Coding interview", line: "The approach, the code and its complexity.", spot: "code" },
  { value: "meeting", label: "Professional meeting", line: "Short, sharp points for work calls.", spot: "panel" },
  { value: "assessment", label: "Online assessment", line: "Practise online tests: Orbit teaches the approach.", spot: "fit" },
  { value: "phone", label: "Phone or room", line: "One microphone hears both sides of the call.", spot: "mic" },
  { value: "mock", label: "Mock interview", line: "The AI asks out loud; you practise, then a review.", spot: "intro" },
];

const PERSONAS: Array<{ value: MockPersona; label: string }> = [
  { value: "recruiter", label: "Recruiter" },
  { value: "hiring_manager", label: "Hiring manager" },
  { value: "engineer", label: "Senior engineer" },
  { value: "staff_engineer", label: "Staff engineer" },
  { value: "executive", label: "Executive" },
];
const MOCK_TYPES: Array<{ value: MockInterviewType; label: string }> = [
  { value: "mixed", label: "Mixed" },
  { value: "behavioral", label: "Behavioral" },
  { value: "technical", label: "Technical" },
  { value: "system_design", label: "System design" },
  { value: "coding", label: "Coding" },
  { value: "negotiation", label: "Salary negotiation" },
];

/** Step 1: the kind of session as illustrated cards, the role, and a mock round's own choices. */
export function SessionStep({
  type,
  onType,
  role,
  onRole,
  mock,
}: {
  type: SessionType;
  onType: (type: SessionType) => void;
  role: string;
  onRole: (role: string) => void;
  mock: {
    persona: MockPersona;
    setPersona: (p: MockPersona) => void;
    focus: MockInterviewType;
    setFocus: (t: MockInterviewType) => void;
    difficulty: MockDifficulty;
    setDifficulty: (d: MockDifficulty) => void;
    minutes: number;
    setMinutes: (m: number) => void;
    offer: string;
    setOffer: (v: string) => void;
    company: string;
    setCompany: (v: string) => void;
    target: string;
    setTarget: (v: string) => void;
    offerExample: { offer: string; target: string } | null;
  };
}) {
  const isMock = type === "mock";
  const negotiation = isMock && mock.focus === "negotiation";
  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Session type" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {SESSION_TYPES.map((t) => (
          <ChoiceTile
            key={t.value}
            name="session-type"
            value={t.value}
            checked={type === t.value}
            onChange={() => onType(t.value)}
            art={<Spot kind={t.spot} />}
            title={t.label}
            detail={<span className="whitespace-normal">{t.line}</span>}
            className="items-start py-3"
          />
        ))}
      </div>

      <Field label={isMock ? "Role you're practising for" : "Role or goal"} htmlFor="setup-role" hint={isMock ? undefined : "Answers are pitched at it. From the tracker, the job's own title."}>
        <Input id="setup-role" value={role} maxLength={200} onChange={(e) => onRole(e.target.value)} placeholder="Senior Security Engineer" />
      </Field>

      {isMock && (
        <div className="rounded-xl bg-orange-500/[0.06] p-4 ring-1 ring-inset ring-orange-500/20">
          <p className="text-xs text-zinc-600 dark:text-zinc-300">
            {negotiation
              ? "The AI plays a recruiter who has just made you this offer. Negotiate out loud; your review grades how you anchored, justified and handled pushback."
              : "The AI interviewer asks out loud, follows up on what you say, and you get a graded review at the end. Only your microphone is used."}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {negotiation ? (
              <Field label="Company" htmlFor="mock-company">
                <Input id="mock-company" value={mock.company} onChange={(e) => mock.setCompany(e.target.value)} maxLength={120} placeholder="Acme" />
              </Field>
            ) : (
              <Field label="Interviewer" htmlFor="mock-persona">
                <Select id="mock-persona" value={mock.persona} onChange={(e) => mock.setPersona(e.target.value as MockPersona)}>
                  {PERSONAS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Focus" htmlFor="mock-focus">
              <Select id="mock-focus" value={mock.focus} onChange={(e) => mock.setFocus(e.target.value as MockInterviewType)}>
                {MOCK_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={negotiation ? "Recruiter" : "Difficulty"} htmlFor="mock-difficulty">
              <Select id="mock-difficulty" value={mock.difficulty} onChange={(e) => mock.setDifficulty(e.target.value as MockDifficulty)}>
                <option value="easy">{negotiation ? "Flexible" : "Easy"}</option>
                <option value="medium">{negotiation ? "Realistic" : "Medium"}</option>
                <option value="hard">{negotiation ? "Tough" : "Hard"}</option>
              </Select>
            </Field>
            <Field label="Length" htmlFor="mock-length">
              <Select id="mock-length" value={mock.minutes} onChange={(e) => mock.setMinutes(Number(e.target.value))}>
                {[10, 20, 30, 45].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </Select>
            </Field>
            {negotiation && (
              <>
                <div className="sm:col-span-2">
                  <Field label="The offer" htmlFor="mock-offer" required>
                    <Input id="mock-offer" value={mock.offer} onChange={(e) => mock.setOffer(e.target.value)} maxLength={300} placeholder={mock.offerExample?.offer ?? "The base pay and bonus, as offered"} />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Your target (optional, only your review sees it)" htmlFor="mock-target">
                    <Input id="mock-target" value={mock.target} onChange={(e) => mock.setTarget(e.target.value)} maxLength={300} placeholder={mock.offerExample?.target ?? "What you'd like instead"} />
                  </Field>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
