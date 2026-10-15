import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { EngineeringTelemetry } from "@orbit/types";
import { OrbitWordmark, cx, focusRing } from "@orbit/ui";
import { ArchitecturePipeline } from "../components/ArchitecturePipeline";
import { Footer } from "../components/Footer";
import { SiteMenu } from "../components/SiteMenu";
import { api } from "../lib/api";
import { useDocumentTitle } from "../lib/useDocumentTitle";

/** The desktop app's protections, each one something the shipped app does (apps/desktop/src-tauri). */
const DESKTOP = [
  { title: "Sign-in in the OS vault", body: "Your session token lives in the Windows Credential Manager, macOS Keychain or Secret Service: never in a file or browser storage." },
  { title: "No AI keys on your computer", body: "DeepSeek and Deepgram keys stay on Orbit's server. The app only ever holds your own session." },
  { title: "Signed updates", body: "Every installer is checked against Orbit's minisign public key, built into the app, before it runs, so a compromised server can't push code." },
  { title: "Locked-down window", body: "A strict content policy: no frames, no forms posting elsewhere, no plugins, scripts only from the app itself." },
];

export function formatUptime(s: number): string {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86_400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86_400)} days`;
}

function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** /technical: how Orbit is built, with live latency from the last 7 days and the desktop app's protections. */
export function TechnicalPage() {
  useDocumentTitle("How Orbit works", "Live latency, the answer pipeline, and how the desktop app keeps your data safe.");
  const [t, setT] = useState<EngineeringTelemetry | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.engineeringTelemetry().then(setT, () => setFailed(true));
  }, []);

  const stats = [
    { label: "Question recognised (median)", value: t?.question_detected ? seconds(t.question_detected.p50_ms) : null, sub: t?.question_detected ? `95% within ${seconds(t.question_detected.p95_ms)}` : null },
    { label: "First word of the answer (median)", value: t?.first_word ? seconds(t.first_word.p50_ms) : null, sub: t?.first_word ? `95% within ${seconds(t.first_word.p95_ms)}` : null },
    { label: "API up for", value: t ? formatUptime(t.up_for_s) : null, sub: "since the last deploy" },
  ];

  return (
    <div className="flex min-h-full flex-col overflow-x-clip">
      <header className="border-b border-zinc-200/70 bg-white dark:border-white/5 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className={cx("shrink-0 rounded-lg", focusRing)} aria-label="Orbit home">
            <OrbitWordmark size={26} />
          </Link>
          <div className="ml-auto"><SiteMenu /></div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6">
        <p className="text-sm font-semibold text-sky-700 dark:text-sky-300">Technical details</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">How Orbit answers in real time</h1>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-300">
          The numbers below are measured from real live sessions over the last {t?.window_days ?? 7} days. Nothing about who was in them, or what was said, is used.
        </p>

        <section aria-labelledby="tele" className="mt-8">
          <h2 id="tele" className="sr-only">Live latency</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {stats.map((s) => (
              <div key={s.label} className="orbit-card rounded-2xl p-4">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{s.label}</p>
                <p className="mt-1 min-h-9 font-display text-3xl font-semibold tabular-nums">{s.value ?? (t || failed ? "—" : "…")}</p>
                <p className="min-h-5 text-xs text-zinc-500 dark:text-zinc-400">{s.sub ?? (t && !s.value ? "Not enough sessions measured yet" : "")}</p>
              </div>
            ))}
          </div>
          {t && t.sessions > 0 && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">From {t.sessions} sessions. Updated every 5 minutes.</p>}
          {failed && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Live numbers couldn't be loaded just now.</p>}
        </section>

        <section aria-labelledby="pipe" className="mt-12">
          <h2 id="pipe" className="font-display text-xl font-semibold">From the interviewer's question to your answer</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Hover or tap a stage to see what it guarantees.</p>
          <div className="mt-5"><ArchitecturePipeline /></div>
        </section>

        <section aria-labelledby="desk" className="mt-12">
          <h2 id="desk" className="font-display text-xl font-semibold">The desktop app's security</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {DESKTOP.map((d) => (
              <li key={d.title} className="orbit-card rounded-2xl p-4">
                <h3 className="font-medium">{d.title}</h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{d.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <Footer />
    </div>
  );
}
