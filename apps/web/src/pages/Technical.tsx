import { useEffect, useState } from "react";
import type { EngineeringTelemetry } from "@orbit/types";
import { ArchitecturePipeline } from "../components/ArchitecturePipeline";
import { api } from "../lib/api";
import { PublicLayout } from "../marketing/PublicLayout";

/** The desktop app's protections, each one something the shipped app does (apps/desktop/src-tauri). */
const DESKTOP = [
  { title: "Sign-in in the OS vault", body: "Your session token lives in the Windows Credential Manager, macOS Keychain or Secret Service: never in a file or browser storage." },
  { title: "No AI keys on your computer", body: "The AI and transcription keys stay on Orbit's server. The app only ever holds your own session." },
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
    <PublicLayout context="How Orbit works">
      <div className="mx-auto w-full max-w-6xl px-5 pb-20 pt-12 sm:px-8 sm:pt-16">
        <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Technical details</p>
        <h1 className="mk-display mt-4 text-zinc-950 dark:text-white">How Orbit answers in real time</h1>
        <p className="mk-lead mt-5 max-w-2xl text-zinc-600 dark:text-zinc-300">
          The numbers below are measured from real live sessions over the last {t?.window_days ?? 7} days. Nothing about who was in them, or what was said, is used.
        </p>

        <section aria-labelledby="tele" className="mt-8">
          <h2 id="tele" className="sr-only">Live latency</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {stats.map((s) => (
              <div key={s.label} className="orbit-card rounded-2xl p-4">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{s.label}</p>
                <p className="stat-value mt-1 min-h-9 text-3xl font-semibold tabular-nums tracking-tight">{s.value ?? (t || failed ? "—" : "…")}</p>
                <p className="min-h-5 text-xs text-zinc-500 dark:text-zinc-400">{s.sub ?? (t && !s.value ? "Not enough sessions measured yet" : "")}</p>
              </div>
            ))}
          </div>
          {t && t.sessions > 0 && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">From {t.sessions} sessions. Updated every 5 minutes.</p>}
          {failed && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Live numbers couldn't be loaded just now.</p>}
        </section>

        <section aria-labelledby="pipe" className="mt-12">
          <h2 id="pipe" className="mk-h3 text-zinc-950 dark:text-white">From the interviewer's question to your answer</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Hover or tap a stage to see what it guarantees.</p>
          <div className="mt-5"><ArchitecturePipeline /></div>
        </section>

        <section aria-labelledby="desk" className="mt-12">
          <h2 id="desk" className="mk-h3 text-zinc-950 dark:text-white">The desktop app's security</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {DESKTOP.map((d) => (
              <li key={d.title} className="orbit-card rounded-2xl p-4">
                <h3 className="font-medium">{d.title}</h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{d.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PublicLayout>
  );
}
