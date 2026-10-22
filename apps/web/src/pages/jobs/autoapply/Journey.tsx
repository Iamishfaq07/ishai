import { SpotArt } from "../../../components/SpotArt";
import { Link } from "react-router-dom";
import { LoadGate, Rocket, buttonClass } from "@orbit/ui";
import { ErrorNote, PageHeader } from "../../../components/ui";
import { api } from "../../../lib/api";
import { errorText } from "../../../lib/format";
import { useAsync } from "../../../lib/useAsync";
import { AgentConsole } from "./AgentConsole";

interface Journey {
  steps: Array<{ id: string; title: string; done: boolean; href: string; detail: string }>;
  next_step: string; packets: Record<string, number>; tracker: Record<string, number>;
  paused: boolean; needs_attention: number; email_verified: boolean; execution: "browser" | "hosted";
  hosted_online: boolean; executor_ready: boolean;
}

export function CareerJourneyPage() {
  const state = useAsync(() => api.call<Journey>("/v1/apply/journey"), [], "career-journey");
  const data = state.data;
  const next = data?.steps.find((step) => step.id === data.next_step);
  return <div className="space-y-6">
    <PageHeader art={<SpotArt kind="search" />} icon={Rocket} title="Auto-apply" subtitle="Orbit finds jobs that fit, prepares each application and sends what it can. You approve the rules once." actions={<Link to="/jobs/auto-apply" className={buttonClass("secondary", "sm")}>Settings</Link>} />
    {next && <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-500/20 dark:bg-indigo-500/5" aria-label="Your next career step">
      <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Your next step</p>
      <h2 className="mt-2 text-lg font-semibold">{next.title}</h2><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{next.detail}</p>
      <Link to={next.href} className={buttonClass("primary", "sm", "mt-4")}>Continue · {next.title}</Link>
    </section>}
    <AgentConsole onChanged={state.reload} />
    <LoadGate loading={state.loading && !data} variant="card" count={3} label="Loading your career journey">
      {state.error && <ErrorNote onRetry={state.reload}>{errorText(state.error)}</ErrorNote>}
      {data && <>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold">Your application activity</h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{data.packets.submitted ?? 0} automatic submissions · {data.needs_attention} need attention · {data.tracker.interviewing ?? 0} interviewing · {data.tracker.offer ?? 0} offers · {data.tracker.hired ?? 0} hired</p>
          {data.paused && <p className="mt-3 text-sm">Automatic applications are paused. Resume them from Orbit Apply when you are ready.</p>}
          {!data.email_verified && <p className="mt-3 text-sm">Verify your account email before unattended applications can be sent.</p>}
          <p className="mt-3 text-sm">{data.execution === "hosted"
            ? data.hosted_online ? "Hosted worker online · supported applications can continue with your browser closed." : "Hosted worker offline · external applications are waiting."
            : data.executor_ready ? "Connected browser ready · it sends external applications while it is open." : "Approved applications wait in Needs you, ready for you to send. Nothing to install."}</p>
        </div>
        <details className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
          <summary className="cursor-pointer rounded-lg p-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">Your full career journey · {data.steps.filter((step) => step.done).length} of {data.steps.length} steps ready</summary>
        <ol className="mt-4 grid gap-4 md:grid-cols-2">{data.steps.map((step, index) => <li key={step.id} className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-zinc-900" aria-current={data.next_step === step.id ? "step" : undefined}>
          <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">Step {index + 1} · {step.done ? "Ready" : data.next_step === step.id ? "Your next step" : "To do"}</p>
          <h2 className="mt-2 text-lg font-semibold">{step.title}</h2><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{step.detail}</p>
          <Link to={step.href} className={buttonClass(data.next_step === step.id ? "primary" : "secondary", "sm", "mt-4")}>{step.done ? "Review" : "Continue"} · {step.title}</Link>
        </li>)}</ol></details>
        <p className="text-sm text-zinc-500">Orbit sends Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable and Recruitee employer forms where hosted applying is on, and Orbit Business jobs everywhere. Human checks, logins, unknown attestations and unsupported sites need your input. You can pause at any time.</p>
      </>}
    </LoadGate>
  </div>;
}
