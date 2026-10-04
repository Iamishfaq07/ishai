import { Suspense, useCallback, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { FileText, OrbitWordmark, ShieldCheck, Sparkles, Wand2, cx, focusRing } from "@orbit/ui";
import { Spinner } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { guestResume } from "./backend";
import { ResumeEditorPage } from "./ResumeEditor";
import { NewResume } from "./Resumes";

const POINTS = [
  { icon: Sparkles, text: "ATS score out of 100, with a fix for every missing point" },
  { icon: Wand2, text: "AI that rewrites weak lines, adds skills and bullets, and puts numbers where they belong" },
  { icon: ShieldCheck, text: "Free, no account. Your resume stays in this browser" },
];

/** The free resume maker, open to anyone: no sign-in, the resume lives on this device. Signed-in people use their account's. */
export function GuestResumeMakerPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [has, setHas] = useState(() => guestResume.has());
  const startOver = useCallback(() => {
    guestResume.clear();
    setHas(false);
  }, []);

  if (user) return <Navigate to="/documents/resumes" replace />;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-zinc-200/70 bg-white/90 dark:border-white/5 dark:bg-zinc-950/85">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/login" className={cx("rounded-lg", focusRing)} aria-label="Orbit">
            <OrbitWordmark size={26} />
          </Link>
          <span className="hidden text-sm text-zinc-500 sm:inline dark:text-zinc-400">Free resume maker</span>
          <nav className="ml-auto flex items-center gap-2 text-sm">
            <Link to="/login" className={cx("rounded-lg px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-900/5 dark:text-zinc-200 dark:hover:bg-white/10", focusRing)}>
              Sign in
            </Link>
            <Link to="/register" className={cx("rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500", focusRing)}>
              Create account
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {loading ? (
          <Spinner label="Loading" big />
        ) : has ? (
          <Suspense fallback={<Spinner label="Opening your resume" state="searching" big />}>
            <ResumeEditorPage guest onStartOver={startOver} />
          </Suspense>
        ) : (
          <div className="mx-auto max-w-2xl animate-fade-up">
            <div className="mb-8 text-center">
              <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                <FileText className="h-6 w-6" aria-hidden />
              </span>
              <h1 className="font-display text-3xl font-semibold tracking-tight">Build a resume that gets past the screen</h1>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Free for everyone. No account, no card.</p>
            </div>
            <ul className="mb-6 space-y-2">
              {POINTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                  <Icon className="h-4 w-4 shrink-0 text-indigo-500" aria-hidden /> {text}
                </li>
              ))}
            </ul>
            <NewResume
              guest
              onCreated={(imported) => {
                navigate(".", { replace: true, state: { imported } });
                setHas(true);
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
