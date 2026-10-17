import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Globe, MapPin, OrbitWordmark, WelcomeScene, buttonClass, cx, focusRing, isIndia, regionExamples } from "@orbit/ui";
import { ProductMark } from "../components/products";
import { Input } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  ANYWHERE,
  ANYWHERE_IN_INDIA,
  GOALS,
  PLACE_IDEAS,
  REMOTE,
  answersShapeJobSearch,
  experienceChoices,
  goalFromPath,
  prefsFromAnswers,
  roleIdeas,
  saveAnswers,
  type Experience,
  type Goal,
  type WelcomeAnswers,
} from "../lib/onboarding";
import { useAsync } from "../lib/useAsync";
import { CountryField } from "../components/CountryField";
import { useCountry } from "../lib/country";
import { anywhereLabel } from "./jobs/model";

/**
 * Right after sign-up: three questions, one tap each where possible (what you're here for; your experience and the
 * job you want; where), then Home with the next step those answers pick. Every question can be skipped. The answers
 * stay in this browser for this account; the role, experience and city also fill the Jobs AI search profile, so the
 * first job matches are about the right jobs. Nothing here calls the AI.
 */

const QUESTIONS = 3;

/** Where the visitor was going before sign-up (a product page's "Start free"), if it's one of ours. */
function useFrom(): string | null {
  const { state } = useLocation();
  const from = (state as { from?: string } | null)?.from;
  return from && from.startsWith("/") && !from.startsWith("//") && from !== "/welcome" ? from : null;
}

function Choice({
  pressed,
  onClick,
  children,
  className,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        "group flex w-full items-center gap-4 rounded-2xl p-4 text-left ring-1 transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.99] motion-reduce:transform-none",
        pressed
          ? "bg-indigo-500/10 ring-2 ring-indigo-500 dark:bg-indigo-400/10 dark:ring-indigo-300"
          : "bg-white/80 ring-zinc-200 hover:bg-white hover:ring-indigo-400/50 dark:bg-white/[0.04] dark:ring-white/10 dark:hover:bg-white/[0.07]",
        focusRing,
        className,
      )}
    >
      {children}
    </button>
  );
}

function Chip({ pressed, onClick, children }: { pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium ring-1 transition-colors",
        pressed
          ? "bg-indigo-600 text-white ring-indigo-600 dark:ring-indigo-400"
          : "bg-white/80 text-zinc-800 ring-zinc-200 hover:ring-indigo-400/60 dark:bg-white/[0.05] dark:text-zinc-100 dark:ring-white/10",
        focusRing,
      )}
    >
      {children}
    </button>
  );
}

export function WelcomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const from = useFrom();
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState<Goal | null>(() => goalFromPath(from));
  const [experience, setExperience] = useState<Experience | null>(null);
  const [role, setRole] = useState("");
  const [otherCity, setOtherCity] = useState("");
  const [saving, setSaving] = useState(false);
  // The search profile as it is now (worked out from a resume, or empty), to add the answers to.
  const profile = useAsync(() => api.jobProfile(), [], "job-profile");
  const country = useCountry();
  const india = isIndia(country);
  const anywhere = india ? ANYWHERE_IN_INDIA : ANYWHERE;
  const cities = (profile.data?.cities ?? (india ? PLACE_IDEAS : [])).filter((c) => c !== ANYWHERE_IN_INDIA && c !== ANYWHERE).slice(0, 9);
  const otherCityExample = regionExamples(country).otherCity;

  // Each question's heading takes focus, so a screen reader hears the new question and Tab starts from it.
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);
  const roleBox = useRef<HTMLDivElement>(null);

  const finish = async (status: WelcomeAnswers["status"], place: string | null = null) => {
    if (!user || saving) return;
    const answers: WelcomeAnswers = { goal, experience, role: role.trim(), place, status, at: new Date().toISOString() };
    saveAnswers(user.id, answers);
    if (answersShapeJobSearch(answers)) {
      setSaving(true);
      try {
        const base = profile.data ?? (await api.jobProfile());
        const saved = await api.saveJobProfile(prefsFromAnswers(base.prefs, answers), base.resume?.id ?? null);
        profile.setData(() => saved);
      } catch {
        // Home still has the answers; the search profile can be set on its own page.
      }
    }
    navigate(from ?? "/", { replace: true, state: { welcomed: status === "done" } });
  };

  const pickGoal = (g: Goal) => {
    setGoal(g);
    setStep(1);
  };
  const pickExperience = (e: Experience) => {
    setExperience(e);
    // The role question appears under it: bring it into view without opening a phone's keyboard.
    window.requestAnimationFrame(() => roleBox.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const submitRole = (e: FormEvent) => {
    e.preventDefault();
    setStep(2);
  };
  const submitCity = (e: FormEvent) => {
    e.preventDefault();
    void finish("done", otherCity.trim() || null);
  };

  const titles = ["What do you want to do first?", "Tell us about your experience", "Where do you want to work?"];
  const subtitles = [
    "Pick one. You can use all three later; this decides what Home shows you first.",
    "So practice questions and job matches fit where you are.",
    `For your job matches. Pick a city, ${anywhereLabel(country).replace(/^Anywhere/, "anywhere")}, or remote.`,
  ];

  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-4 sm:px-6">
        <OrbitWordmark size={26} />
        <button
          type="button"
          onClick={() => void finish("skipped")}
          disabled={saving}
          className={cx("ml-auto inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white", focusRing)}
        >
          Skip for now
        </button>
      </header>

      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 sm:px-6">
        <div className="flex items-center gap-3">
          <p className="shrink-0 text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Question {step + 1} of {QUESTIONS}
          </p>
          <div aria-hidden="true" className="grid flex-1 grid-cols-3 gap-1.5">
            {Array.from({ length: QUESTIONS }, (_, i) => (
              <span
                key={i}
                className={cx("h-1.5 rounded-full transition-colors duration-300", i <= step ? "bg-indigo-600" : "bg-zinc-200 dark:bg-white/10")}
              />
            ))}
          </div>
        </div>

        {user?.approval_pending && step === 0 && (
          <p className="mt-5 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-500/25 dark:text-amber-100">
            Your account is waiting for access. Answer these now, and meanwhile{" "}
            <Link to="/warmup" className="font-medium underline">
              try a free practice question
            </Link>
            .
          </p>
        )}

        <div key={step} className="animate-fade-up">
          {step === 0 && <WelcomeScene className="mt-6 w-44" />}
          <h1 ref={heading} tabIndex={-1} className="mt-6 text-balance font-display text-3xl font-semibold leading-tight tracking-tight outline-none sm:text-4xl">
            {titles[step]}
          </h1>
          <p className="mt-2 text-base text-zinc-600 dark:text-zinc-300">{subtitles[step]}</p>

          {step === 0 && (
            <ul className="mt-7 space-y-3">
              {GOALS.map((g) => (
                <li key={g.id}>
                  <Choice pressed={goal === g.id} onClick={() => pickGoal(g.id)}>
                    <ProductMark product={g.id} size="lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-lg font-semibold">{g.title}</span>
                      <span className="mt-0.5 block text-sm text-zinc-600 dark:text-zinc-300">{g.body}</span>
                    </span>
                    <ArrowRight className="h-5 w-5 shrink-0 text-zinc-400 motion-ok:transition-transform group-hover:text-indigo-500 motion-ok:group-hover:translate-x-1" aria-hidden />
                  </Choice>
                </li>
              ))}
            </ul>
          )}

          {step === 1 && (
            <div className="mt-7 space-y-8">
              <fieldset>
                <legend className="text-sm font-medium text-zinc-800 dark:text-zinc-200">How much work experience do you have?</legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {experienceChoices(country).map((e) => (
                    <Choice key={e.id} pressed={experience === e.id} onClick={() => pickExperience(e.id)} className="sm:flex-col sm:items-start sm:gap-1">
                      <span className="block font-display text-base font-semibold">{e.title}</span>
                      <span className="block text-sm text-zinc-600 dark:text-zinc-300">{e.body}</span>
                    </Choice>
                  ))}
                </div>
              </fieldset>

              <div ref={roleBox} className={cx("scroll-mt-24 transition-opacity", experience ? "opacity-100" : "opacity-60")}>
                <form onSubmit={submitRole}>
                  <label htmlFor="welcome-role" className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    What job do you want? <span className="font-normal text-zinc-600 dark:text-zinc-400">(you can change it any time)</span>
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {roleIdeas(experience ?? "fresher", country).map((idea) => (
                      <Chip
                        key={idea}
                        pressed={role === idea}
                        onClick={() => {
                          setRole(idea);
                          setStep(2);
                        }}
                      >
                        {idea}
                      </Chip>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Input
                      id="welcome-role"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      placeholder="Or type it, e.g. Java developer"
                      autoComplete="organization-title"
                      maxLength={80}
                      className="min-h-11 text-base"
                    />
                    <button
                      type="submit"
                      className={buttonClass("primary", "md", "min-h-11 shrink-0")}
                    >
                      Next <ArrowRight className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="mt-7 space-y-6">
              <div className="max-w-sm">
                <CountryField id="welcome-country" hint="Jobs, cities, salaries and practice follow it." onChanged={() => profile.reload()} />
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Cities">
                {cities.map((c) => (
                  <Chip key={c} onClick={() => void finish("done", c)}>
                    <MapPin className="h-4 w-4 opacity-70" aria-hidden /> {c}
                  </Chip>
                ))}
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Anywhere">
                <Chip onClick={() => void finish("done", anywhere)}>{anywhereLabel(country)}</Chip>
                <Chip onClick={() => void finish("done", REMOTE)}>
                  <Globe className="h-4 w-4 opacity-70" aria-hidden /> Remote
                </Chip>
              </div>
              <form onSubmit={submitCity} className="flex gap-2">
                <label htmlFor="welcome-city" className="sr-only">
                  Another city
                </label>
                <Input
                  id="welcome-city"
                  value={otherCity}
                  onChange={(e) => setOtherCity(e.target.value)}
                  placeholder={otherCityExample ? `Another city, e.g. ${otherCityExample}` : "Another city"}
                  autoComplete="address-level2"
                  maxLength={60}
                  className="min-h-11 text-base"
                />
                <button type="submit" disabled={saving} className={buttonClass("primary", "md", "min-h-11 shrink-0")}>
                  {saving ? "Saving…" : "Done"}
                </button>
              </form>
              {saving && (
                <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
                  Setting up your job matches…
                </p>
              )}
            </div>
          )}

          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              disabled={saving}
              className={cx("mt-8 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white", focusRing)}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
