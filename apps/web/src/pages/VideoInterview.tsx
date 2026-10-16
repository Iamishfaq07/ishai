import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { CreateSessionRequest, MockDifficulty, OrbitDocument } from "@orbit/types";
import { INTERVIEWER_NAME, LoadGate, Video, cx, focusRing } from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import type { LiveLaunchState } from "./SessionSetup";

type Source = "job" | "topic" | "resume";
const TOPICS = ["Behavioral (STAR stories)", "System design", "Data structures & algorithms", "SQL & databases", "React & frontend", "Product sense", "Machine learning", "Leadership"];
const NEW_JD = "__paste__";

/** Camera preview and a live mic level, so the call starts with both working. Released before joining. */
function DeviceCheck({ onReady }: { onReady: (ok: boolean) => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: true })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += v * v;
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 8));
          raf = requestAnimationFrame(tick);
        };
        tick();
        onReady(true);
      })
      .catch(() => {
        setError("Orbit couldn't use your camera and microphone. Allow them in the browser (the icon in the address bar), then reload.");
        onReady(false);
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      void ctx?.close();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onReady]);
  return (
    <div className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-zinc-900 ring-1 ring-zinc-200 dark:ring-white/10">
        {error ? (
          <p className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-300">{error}</p>
        ) : (
          <video ref={video} autoPlay muted playsInline aria-label="Your camera preview" className="h-full w-full -scale-x-100 object-cover" />
        )}
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">Microphone</span>
        <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
          <span className="block h-full rounded-full bg-emerald-500 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
        </span>
        <span className="text-xs text-zinc-500">{level > 0.08 ? "We hear you" : "Say something"}</span>
      </div>
    </div>
  );
}

/**
 * The AI video interview, set up: what the interviewer asks about (a job description, a topic, or your resume), then a
 * camera and microphone check, then the video-call room (VideoInterviewRoom) with the live, adaptive interviewer.
 */
export function VideoInterviewPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const docs = useAsync(() => api.listDocuments(), [], "documents");
  const ready = (kind: OrbitDocument["kind"]) => (docs.data ?? []).filter((d) => d.kind === kind && d.status === "ready");
  const resumes = ready("resume");
  const jds = ready("job_description");
  const [source, setSource] = useState<Source>(params.get("topic") ? "topic" : "job");
  const [jdChoice, setJdChoice] = useState<string>("");
  const [jdText, setJdText] = useState("");
  const [topic, setTopic] = useState(params.get("topic") ?? "");
  const [resumeChoice, setResumeChoice] = useState<string>("");
  const [role, setRole] = useState(params.get("role") ?? "");
  const [company, setCompany] = useState(params.get("company") ?? "");
  const [difficulty, setDifficulty] = useState<MockDifficulty>("medium");
  const [minutes, setMinutes] = useState(15);
  const [step, setStep] = useState<"setup" | "check">("setup");
  const [devicesOk, setDevicesOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const jdId = jdChoice === NEW_JD ? null : jdChoice || jds[0]?.id || null;
  const pasting = source === "job" && (jdChoice === NEW_JD || jds.length === 0);
  const resumeId = resumeChoice || resumes[0]?.id || null;
  const canContinue =
    source === "topic" ? topic.trim().length >= 2 : source === "job" ? (pasting ? jdText.trim().length >= 80 : Boolean(jdId)) : Boolean(resumeId);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      let jobDoc = source === "job" && !pasting ? jdId : null;
      if (source === "job" && pasting) {
        const doc = await api.createTextDocument({ title: `Job post${role ? `: ${role}` : ""}${company ? ` at ${company}` : ""}`.slice(0, 120), kind: "job_description", text: jdText.trim() });
        jobDoc = doc.id;
      }
      const about = source === "topic" ? topic.trim() : role.trim() || (source === "job" ? "the job" : "my experience");
      const req: CreateSessionRequest = {
        title: `Video interview: ${about}`.slice(0, 120),
        type: "mock",
        language: "en",
        length: "standard",
        style: "natural",
        auto_answer: false,
        ...(role.trim() ? { role: role.trim() } : {}),
        document_ids: [resumeId, jobDoc].filter((x): x is string => Boolean(x)),
        mock: {
          video: true,
          ...(source === "topic" ? { topic: topic.trim() } : {}),
          ...(company.trim() ? { company: company.trim() } : {}),
          interview_type: "mixed",
          difficulty,
          duration_minutes: minutes,
          adaptive_depth: true,
        },
      };
      const session = await api.createSession(req);
      const launch: LiveLaunchState = { systemAudio: false };
      navigate(`/live/${session.id}`, { state: launch });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const tab = (value: Source, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={source === value}
      onClick={() => setSource(value)}
      className={cx(
        "flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
        source === value ? "bg-white text-zinc-900 shadow-sm dark:bg-white/15 dark:text-white" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
        focusRing,
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        icon={Video}
        title="AI video interview"
        subtitle={`A face-to-face practice interview with ${INTERVIEWER_NAME}, an AI interviewer who asks from the job, your resume or a topic, and follows up on what you say.`}
      />
      {step === "setup" ? (
        <Card className="space-y-5">
          <div>
            <h2 className="font-display text-base font-semibold">What should {INTERVIEWER_NAME} ask about?</h2>
            <div role="tablist" aria-label="Interview source" className="mt-3 flex gap-1 rounded-2xl bg-zinc-100 p-1 dark:bg-white/5">
              {tab("job", "A job description")}
              {tab("topic", "A topic")}
              {tab("resume", "My resume")}
            </div>
          </div>
          <LoadGate loading={docs.loading && !docs.data} variant="line" count={2} label="Loading your documents">
            {source === "job" && (
              <div className="space-y-3">
                {jds.length > 0 && (
                  <Field label="Job description" htmlFor="vi-jd">
                    <Select id="vi-jd" value={jdChoice || jds[0]?.id || ""} onChange={(e) => setJdChoice(e.target.value)}>
                      {jds.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.title}
                        </option>
                      ))}
                      <option value={NEW_JD}>Paste a new one…</option>
                    </Select>
                  </Field>
                )}
                {pasting && (
                  <Field label="Paste the job description" htmlFor="vi-jd-text" hint="The whole post: responsibilities and requirements. It's saved to your Documents.">
                    <Textarea id="vi-jd-text" rows={7} value={jdText} onChange={(e) => setJdText(e.target.value)} placeholder="About the role… What you'll do… What we're looking for…" />
                  </Field>
                )}
              </div>
            )}
            {source === "topic" && (
              <div className="space-y-3">
                <Field label="Topic" htmlFor="vi-topic" hint="Every question tests it, made specific to your resume.">
                  <Input id="vi-topic" value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. React performance, payments system design" />
                </Field>
                <div className="flex flex-wrap gap-2">
                  {TOPICS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTopic(t)}
                      className={cx("rounded-full border px-3 py-1 text-xs", topic === t ? "border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200" : "border-zinc-200 text-zinc-600 hover:border-indigo-400 dark:border-white/10 dark:text-zinc-300", focusRing)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Resume" htmlFor="vi-resume" hint={resumes.length ? "Questions are made specific to it." : "Add one in Documents for questions about your experience."}>
                <Select id="vi-resume" value={resumeId ?? ""} onChange={(e) => setResumeChoice(e.target.value)} disabled={!resumes.length}>
                  {resumes.length ? resumes.map((d) => <option key={d.id} value={d.id}>{d.title}</option>) : <option value="">No resume uploaded</option>}
                </Select>
              </Field>
              <Field label="Role (optional)" htmlFor="vi-role">
                <Input id="vi-role" value={role} maxLength={120} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Backend Engineer" />
              </Field>
              <Field label="Company (optional)" htmlFor="vi-company">
                <Input id="vi-company" value={company} maxLength={120} onChange={(e) => setCompany(e.target.value)} placeholder="Interviewed in its style when known" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Difficulty" htmlFor="vi-difficulty">
                  <Select id="vi-difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value as MockDifficulty)}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </Select>
                </Field>
                <Field label="Length" htmlFor="vi-minutes">
                  <Select id="vi-minutes" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                    {[10, 15, 20, 30].map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>
          </LoadGate>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-white/10">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Uses your interview minutes. Your camera stays on your device; nothing is recorded.</p>
            <Button onClick={() => setStep("check")} disabled={!canContinue}>
              Next: check camera & mic
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="space-y-4">
          <h2 className="font-display text-base font-semibold">Check your camera and microphone</h2>
          <DeviceCheck onReady={setDevicesOk} />
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
            <li>Sit facing a light, with the camera at eye level.</li>
            <li>{INTERVIEWER_NAME} speaks each question; answer out loud, then press "I'm done answering" (or pause for a moment).</li>
            <li>Use headphones if you can, so {INTERVIEWER_NAME}'s voice isn't picked up as your answer.</li>
          </ul>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep("setup")}>
              Back
            </Button>
            <Button onClick={() => void join()} disabled={busy || !devicesOk}>
              {busy ? "Starting…" : "Join the interview"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
