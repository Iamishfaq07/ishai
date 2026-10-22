import { Link } from "react-router-dom";
import { ArrowRight, Check, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";

interface JourneyStep { id: string; title: string; done: boolean; href: string; detail: string }
interface Journey { steps: JourneyStep[] }

/** The steps that set Orbit up (auto_apply/journey.py), in order, then saving a first job. The later journey steps
 *  (applications, interviews, an offer) are the search itself, not setup, so they stay on Auto Apply. */
const SETUP = ["resume", "search", "approve", "activate"];

/** Short names for the checklist; the journey's own titles and details explain each step where it's done. */
const SHORT: Record<string, string> = {
  resume: "Add your resume",
  search: "Choose the jobs you want",
  approve: "Approve your resume and answers",
  activate: "Turn on auto-apply",
  job: "Save your first job",
};

/**
 * Today's "Get set up" card for a new account: the few steps that make every other tool work, ticked from the
 * account's real state, with the next one as the single action. It goes away by itself once all are done, and
 * says nothing while it loads or if the journey can't be read (Today works without it).
 */
export function SetupChecklist({ jobsSaved }: { jobsSaved: number | null }) {
  const journey = useAsync(() => api.call<Journey>("/v1/apply/journey"), [], "career-journey");
  if (!journey.data || jobsSaved === null) return null;
  const byId = new Map(journey.data.steps.map((s) => [s.id, s]));
  const steps = [
    ...SETUP.flatMap((id) => {
      const s = byId.get(id);
      return s ? [{ id, label: SHORT[id] ?? s.title, detail: s.detail, href: s.href, done: s.done }] : [];
    }),
    { id: "job", label: SHORT.job!, detail: "Every job you save gets a tailored resume, its application and the people to contact.", href: "/jobs/matches", done: jobsSaved > 0 },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.find((s) => !s.done)!;
  return <section aria-labelledby="get-set-up" className="route-rise rounded-2xl bg-white p-6 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-white/10">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="get-set-up" className="text-lg font-semibold">Get set up</h2>
      <span className="text-sm text-zinc-600 dark:text-zinc-400">{done} of {steps.length} done</span>
    </div>
    <div aria-hidden className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
      <div className="h-full rounded-full bg-indigo-600 motion-safe:transition-[width] dark:bg-indigo-400" style={{ width: `${(done / steps.length) * 100}%` }} />
    </div>
    <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{steps.map((s, i) => {
      const current = s.id === next.id;
      return <li key={s.id}>
        <Link to={s.href} aria-current={current ? "step" : undefined} className={cx("flex h-full items-start gap-2.5 rounded-xl p-3 text-sm",
          current ? "bg-indigo-50 ring-1 ring-indigo-200 dark:bg-indigo-500/10 dark:ring-indigo-500/30" : "hover:bg-zinc-100 dark:hover:bg-white/5", focusRing)}>
          <span className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
            s.done ? "bg-indigo-600 text-white dark:bg-indigo-400 dark:text-zinc-950" : current ? "ring-2 ring-indigo-600 text-indigo-700 dark:ring-indigo-400 dark:text-indigo-300" : "ring-1 ring-zinc-300 text-zinc-500 dark:ring-white/20")}>
            {s.done ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
          </span>
          <span className={cx("font-medium", s.done && "text-zinc-500 line-through decoration-zinc-400 dark:text-zinc-400")}>
            {s.label}<span className="sr-only">{s.done ? " (done)" : current ? " (next)" : ""}</span>
          </span>
        </Link>
      </li>;
    })}</ol>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-white/10">
      <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400"><span className="font-medium text-zinc-900 dark:text-zinc-100">Next: {next.label}.</span> {next.detail}</p>
      <Link to={next.href} className={cx("inline-flex min-h-11 items-center gap-1 rounded text-sm font-semibold text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
        Continue <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  </section>;
}
