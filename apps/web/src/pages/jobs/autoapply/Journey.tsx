import { Link } from "react-router-dom";
import { LoadGate, Rocket, buttonClass } from "@orbit/ui";
import { ErrorNote, PageHeader } from "../../../components/ui";
import { api } from "../../../lib/api";
import { errorText } from "../../../lib/format";
import { useAsync } from "../../../lib/useAsync";

interface Journey {
  steps: Array<{ id: string; title: string; done: boolean; href: string; detail: string }>;
  next_step: string; packets: Record<string, number>; tracker: Record<string, number>;
  paused: boolean; needs_attention: number; email_verified: boolean;
}

export function CareerJourneyPage() {
  const state = useAsync(() => api.call<Journey>("/v1/apply/journey"), [], "career-journey");
  const data = state.data;
  return <div className="space-y-6">
    <PageHeader icon={Rocket} title="Your path to the next role" subtitle="One place for your resume, job matches, approved automatic applications, interviews and offers." />
    <LoadGate loading={state.loading && !data} variant="card" count={3} label="Loading your career journey">
      {state.error && <ErrorNote onRetry={state.reload}>{errorText(state.error)}</ErrorNote>}
      {data && <>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">Your application activity</h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{data.packets.submitted ?? 0} automatic submissions · {data.needs_attention} need attention · {data.tracker.interviewing ?? 0} interviewing · {data.tracker.offer ?? 0} offers · {data.tracker.hired ?? 0} hired</p>
          {data.paused && <p className="mt-3 text-sm">Automatic applications are paused. Resume them from Orbit Apply when you are ready.</p>}
          {!data.email_verified && <p className="mt-3 text-sm">Verify your account email before unattended applications can be sent.</p>}
        </div>
        <ol className="space-y-4">{data.steps.map((step, index) => <li key={step.id} className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-zinc-900" aria-current={data.next_step === step.id ? "step" : undefined}>
          <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">Step {index + 1} · {step.done ? "Ready" : data.next_step === step.id ? "Your next step" : "To do"}</p>
          <h2 className="mt-2 text-lg font-semibold">{step.title}</h2><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{step.detail}</p>
          <Link to={step.href} className={buttonClass(data.next_step === step.id ? "primary" : "secondary", "sm", "mt-4")}>{step.done ? "Review" : "Continue"} · {step.title}</Link>
        </li>)}</ol>
        <p className="text-sm text-zinc-500">Orbit Business jobs can submit directly under your approved rules. External supported employer forms use the connected browser extension. Captchas, logins, unknown attestations and unsupported sites need your input. You can pause at any time.</p>
      </>}
    </LoadGate>
  </div>;
}
