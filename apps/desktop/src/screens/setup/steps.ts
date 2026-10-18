/**
 * New session's four steps (DESIGN.md "The desktop app", D77): what each says in the step rail, and whether it's
 * done or wants a look. A step that wants a look never blocks Start by itself: the ready check does that, for the
 * problems that would break a session (no microphone, no minutes, the server down).
 */
export type StepId = "session" | "listen" | "context" | "answers";

export interface StepView {
  id: StepId;
  label: string;
  summary: string;
  done: boolean;
  attention: boolean;
}

export interface StepInput {
  typeLabel: string;
  role: string;
  /** Salary practice without the offer: Start waits for it. */
  needsOffer: boolean;
  micName: string | null;
  /** This kind of session hears the other side (not phone, mock or macOS). */
  interviewerUsed: boolean;
  interviewerOn: boolean;
  /** "Zoom", "Speakers (Realtek)". */
  interviewerName: string | null;
  interviewerWarning: string | null;
  /** The other side is the point (interview, coding, meeting): hearing only the mic is a mistake worth flagging. */
  callType: boolean;
  documents: number;
  hasResume: boolean;
  /** A mock interview reads documents too, but a resume matters less there. */
  isMock: boolean;
  answerSummary: string;
}

export function setupSteps(s: StepInput): StepView[] {
  const role = s.role.trim();
  const listenParts = [s.micName ? shortDevice(s.micName) : "No microphone", s.interviewerUsed ? (s.interviewerOn ? (s.interviewerName ?? "Default output") : "Interviewer off") : null];
  const listenAttention = !s.micName || (s.interviewerUsed && !s.interviewerOn && s.callType) || Boolean(s.interviewerOn && s.interviewerWarning);
  return [
    {
      id: "session",
      label: "Session",
      summary: role ? `${s.typeLabel} · ${role}` : s.typeLabel,
      done: !s.needsOffer,
      attention: s.needsOffer,
    },
    {
      id: "listen",
      label: "Listen to",
      summary: listenParts.filter(Boolean).join(" + "),
      done: !listenAttention,
      attention: listenAttention,
    },
    {
      id: "context",
      label: "Documents",
      summary: s.documents === 0 ? "None picked" : `${s.documents} picked${s.hasResume ? "" : ", no resume"}`,
      done: s.documents > 0 && (s.hasResume || s.isMock),
      attention: !s.isMock && !s.hasResume,
    },
    { id: "answers", label: "Answers", summary: s.answerSummary, done: true, attention: false },
  ];
}

/** "Headset Microphone (Jabra Evolve2 65)" → "Jabra Evolve2 65": the part people recognise. */
export function shortDevice(name: string): string {
  const inner = /\(([^()]+)\)\s*$/.exec(name)?.[1]?.trim();
  return inner && inner.length >= 3 ? inner : name;
}
