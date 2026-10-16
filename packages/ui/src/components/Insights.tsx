import { useState, type ReactNode } from "react";
import type { DeliveryStats, FollowUp, SessionCamera } from "@orbit/types";
import { Check, CircleAlert, CircleCheck, Copy, Mail, RefreshCw } from "../icons";
import { cx, focusRing } from "./cx";
import { Button, Card, ErrorNote } from "./ui";

// Common speech-coaching bands (match apps/api/orbit_api/sessions/delivery.py).
const PACE_OK = [110, 170] as const;
const FILLERS_OK = 4;
const TALK_SHARE_OK = 0.8;
const START_OK = 6;

type Tone = "good" | "warning";

function Status({ tone, label }: { tone: Tone; label: string }) {
  const Icon = tone === "good" ? CircleCheck : CircleAlert;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 text-xs font-medium",
        tone === "good" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

/** A stat tile: sentence-case label, one big value, and a status with icon + words (never colour alone). */
function Tile({ label, value, unit, status }: { label: string; value: string; unit?: string; status?: ReactNode }) {
  return (
    <div className="rounded-xl bg-zinc-500/5 p-3 ring-1 ring-zinc-200 dark:ring-white/[0.06]">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 font-sans text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
        {value}
        {unit && <span className="ml-1 text-sm font-medium text-zinc-500 dark:text-zinc-400">{unit}</span>}
      </p>
      {status && <div className="mt-1">{status}</div>}
    </div>
  );
}

/**
 * "How you sounded": pace, filler words, talk time and answer length from the session transcript. Arithmetic
 * only — no model call. Shared by the web session page and the desktop History screen.
 */
export function DeliveryCard({ delivery }: { delivery: DeliveryStats | null | undefined }) {
  if (!delivery) return null;
  const pace = delivery.words_per_minute;
  const paceTone: Tone = pace >= PACE_OK[0] && pace <= PACE_OK[1] ? "good" : "warning";
  const fillersTone: Tone = delivery.fillers_per_minute <= FILLERS_OK ? "good" : "warning";
  const avgSeconds =
    delivery.average_answer_words !== null && pace > 0 ? Math.round((delivery.average_answer_words / pace) * 60) : null;
  return (
    <Card className="animate-fade-up">
      <h2 className="font-display text-lg font-semibold">How you sounded</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        From your side of the transcript — {Math.max(1, Math.round(delivery.speaking_seconds / 60))} min of speaking.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile
          label="Pace"
          value={String(pace)}
          unit="words/min"
          status={
            <Status
              tone={paceTone}
              label={paceTone === "good" ? "Comfortable" : pace > PACE_OK[1] ? "A bit fast" : "A bit slow"}
            />
          }
        />
        <Tile
          label="Filler words"
          value={String(delivery.fillers_per_minute)}
          unit="/min"
          status={<Status tone={fillersTone} label={fillersTone === "good" ? "Barely noticeable" : "Noticeable"} />}
        />
        {delivery.talk_share !== null && (
          <Tile
            label="Your talk time"
            value={String(Math.round(delivery.talk_share * 100))}
            unit="%"
            status={
              <Status
                tone={delivery.talk_share <= TALK_SHARE_OK ? "good" : "warning"}
                label={delivery.talk_share <= TALK_SHARE_OK ? "Balanced" : "Mostly you"}
              />
            }
          />
        )}
        {avgSeconds !== null && (
          <Tile
            label="Average answer"
            value={avgSeconds >= 60 ? `${Math.floor(avgSeconds / 60)}:${String(avgSeconds % 60).padStart(2, "0")}` : String(avgSeconds)}
            unit={avgSeconds >= 60 ? "min" : "s"}
            status={
              <Status
                tone={avgSeconds <= 120 ? "good" : "warning"}
                label={avgSeconds <= 120 ? "Focused" : "Long-winded"}
              />
            }
          />
        )}
        {delivery.median_start_seconds != null && (
          <Tile
            label="Time to start"
            value={String(delivery.median_start_seconds)}
            unit="s"
            status={
              <Status
                tone={delivery.median_start_seconds <= START_OK ? "good" : "warning"}
                label={delivery.median_start_seconds <= START_OK ? "Quick" : "Long silence"}
              />
            }
          />
        )}
        {delivery.long_pauses != null && (
          <Tile
            label="Pauses mid-answer"
            value={String(delivery.long_pauses)}
            unit="of 3 s+"
            status={<Status tone="good" label={delivery.long_pauses === 0 ? "None long" : "A pause can help"} />}
          />
        )}
      </div>
      <details className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        <summary className={cx("cursor-pointer rounded", focusRing)}>How these are measured</summary>
        <p className="mt-1">
          Counted from the transcript's words and timings for this saved session: pace is words over your speaking time, fillers are words like
          "um" and "you know", time to start is from the end of each question to your first words. They're approximate, and they describe how
          you spoke, not how good an answer was, how confident you are or how an interviewer will judge you.
        </p>
      </details>
      {delivery.top_fillers.length > 0 && (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">
          <span className="text-zinc-500 dark:text-zinc-400">Most used: </span>
          {delivery.top_fillers.map((f) => (
            <span
              key={f.word}
              className="mr-1.5 inline-block rounded-full bg-zinc-500/10 px-2 py-0.5 text-xs font-medium"
            >
              “{f.word}” ×{f.count}
            </span>
          ))}
        </p>
      )}
      {delivery.tips.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {delivery.tips.map((t) => (
            <li key={t} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" aria-hidden="true" />
              {t}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState<"copied" | "failed" | null>(null);
  const show = (result: "copied" | "failed") => {
    setDone(result);
    setTimeout(() => setDone(null), 1500);
  };
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        // Refused (no permission) or missing (insecure page): say so rather than fail silently.
        if (!navigator.clipboard) return show("failed");
        navigator.clipboard.writeText(text).then(
          () => show("copied"),
          () => show("failed"),
        );
      }}
    >
      {done === "copied" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done === "copied" ? "Copied" : done === "failed" ? "Couldn’t copy" : label}
    </Button>
  );
}

const DEBRIEF: Array<{ key: keyof FollowUp["debrief"]; title: string }> = [
  { key: "went_well", title: "What went well" },
  { key: "to_improve", title: "What to improve" },
  { key: "promised", title: "What you promised" },
  { key: "next_steps", title: "Next steps" },
];

/**
 * After a real interview or call: a short debrief and a ready-to-send thank-you email, drafted from the transcript.
 * `load(refresh)` calls the API (generated once and cached server-side). Not shown for mock interviews.
 */
export function FollowUpCard({
  initial,
  load,
  openLink,
}: {
  initial: FollowUp | null | undefined;
  load: (refresh: boolean) => Promise<FollowUp>;
  /** Opens a mailto: link (desktop passes its URL opener; the web uses the default). */
  openLink?: (url: string) => void;
}) {
  const [data, setData] = useState<FollowUp | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (refresh: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setData(await load(refresh));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write the follow-up.");
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <Card className="animate-fade-up">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
            <Mail className="h-5 w-5" />
          </span>
          {/* basis-56: the text keeps a readable width and the button wraps under it on a phone, rather than the
              text squeezing into a column a word wide beside the button. */}
          <div className="min-w-0 flex-1 basis-56">
            <h2 className="font-display text-lg font-semibold">Follow up</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              A quick debrief of this conversation and a thank-you email you can send today.
            </p>
          </div>
          <Button className="w-full sm:w-auto" onClick={() => void run(false)} disabled={busy}>
            {busy ? "Writing…" : "Write my follow-up"}
          </Button>
        </div>
        {error && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
      </Card>
    );
  }

  const email = `${data.thank_you.subject}\n\n${data.thank_you.body}`;
  const mailto = `mailto:?subject=${encodeURIComponent(data.thank_you.subject)}&body=${encodeURIComponent(data.thank_you.body)}`;
  return (
    <Card className="animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Follow up</h2>
        <button
          type="button"
          onClick={() => void run(true)}
          disabled={busy}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-900/5 disabled:opacity-40 dark:hover:bg-white/5",
            focusRing,
          )}
        >
          <RefreshCw className={cx("h-3.5 w-3.5", busy && "motion-safe:animate-spin")} />
          {busy ? "Rewriting…" : "Rewrite"}
        </button>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {DEBRIEF.filter((d) => data.debrief[d.key].length > 0).map((d) => (
          <div key={d.key}>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">{d.title}</p>
            <ul className="mt-1 space-y-1 text-sm">
              {data.debrief[d.key].map((p) => (
                <li key={p} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-aurora-400" aria-hidden="true" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-5 rounded-xl bg-zinc-500/5 p-4 ring-1 ring-zinc-200 dark:ring-white/[0.06]">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Thank-you email</p>
        <p className="mt-2 text-sm font-medium">{data.thank_you.subject}</p>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {data.thank_you.body}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <CopyButton text={email} label="Copy email" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => (openLink ? openLink(mailto) : window.open(mailto, "_self"))}
          >
            <Mail className="h-3.5 w-3.5" />
            Open in email app
          </Button>
        </div>
      </div>
    </Card>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * "On camera": the camera coach's numbers, measured on the person's device during a mock (no video or images were
 * kept or sent), with "facing the camera" across their last few sessions. Descriptive only: it doesn't judge
 * confidence, emotion or how an interviewer will see them.
 */
export function CameraCard({ camera }: { camera: SessionCamera | null | undefined }) {
  if (!camera) return null;
  const m = camera.metrics;
  const movement = m.head_movement_deg_s <= 5 ? "Mostly still" : m.head_movement_deg_s <= 12 ? "Some movement" : "A lot of movement";
  const sawFace = m.face_in_frame_pct > 0;
  const minutes = m.seconds < 60 ? "under a minute" : `${Math.round(m.seconds / 60)} min`;
  const trend = camera.trend;
  return (
    <Card className="animate-fade-up">
      <h2 className="font-display text-lg font-semibold">On camera</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Measured on your device over {minutes} with the camera coach on. The video never left your device.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Face in frame" value={String(Math.round(m.face_in_frame_pct))} unit="%" />
        <Tile label="Facing the camera" value={sawFace ? String(Math.round(m.facing_camera_pct)) : "–"} unit={sawFace ? "% of that time" : undefined} />
        <Tile
          label="Head movement"
          value={sawFace ? String(m.head_movement_deg_s) : "–"}
          unit={sawFace ? "°/s" : undefined}
          status={sawFace ? <span className="text-xs text-zinc-500 dark:text-zinc-400">{movement}</span> : undefined}
        />
      </div>
      {!sawFace && (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
          No face was found in the picture. Check the camera faces you, with light in front of you rather than behind.
        </p>
      )}
      {trend.length > 1 && (
        <figure className="mt-4">
          <figcaption className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Facing the camera, your last {trend.length} sessions</figcaption>
          <div className="mt-2 flex items-end gap-2" role="img" aria-label={`Facing the camera: ${trend.map((p) => `${Math.round(p.facing_camera_pct)}%`).join(", ")}, oldest first`}>
            {trend.map((p, i) => {
              const latest = i === trend.length - 1;
              return (
                <div key={p.session_id} className="flex flex-1 flex-col items-center gap-1" title={`${shortDate(p.at)}: ${Math.round(p.facing_camera_pct)}%`}>
                  <span className={cx("h-4 text-xs font-semibold tabular-nums text-zinc-900 dark:text-zinc-50", !latest && "invisible")}>
                    {Math.round(p.facing_camera_pct)}%
                  </span>
                  {/* Every bar on the same 64px track, so equal values are equal heights. */}
                  <span className="flex h-16 w-full max-w-10 items-end">
                    <span
                      className={cx("w-full rounded-t", latest ? "bg-indigo-500" : "bg-indigo-500/35")}
                      style={{ height: `${Math.max(3, p.facing_camera_pct)}%` }}
                    />
                  </span>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{latest ? "This one" : shortDate(p.at)}</span>
                </div>
              );
            })}
          </div>
          <details className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            <summary className={cx("cursor-pointer rounded", focusRing)}>Show the numbers</summary>
            <table className="mt-1 w-full text-left tabular-nums">
              <thead>
                <tr>
                  <th className="font-medium">Session</th>
                  <th className="font-medium">Face in frame</th>
                  <th className="font-medium">Facing the camera</th>
                  <th className="font-medium">Head movement</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((p) => (
                  <tr key={p.session_id}>
                    <td>{shortDate(p.at)}</td>
                    <td>{Math.round(p.face_in_frame_pct)}%</td>
                    <td>{Math.round(p.facing_camera_pct)}%</td>
                    <td>{p.head_movement_deg_s}°/s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </figure>
      )}
      <details className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        <summary className={cx("cursor-pointer rounded", focusRing)}>How these are measured</summary>
        <p className="mt-1">
          A face model ran in your browser about ten times a second. "Facing the camera" means your head was turned within about 20° of the camera,
          left, right, up or down; it's head direction, not where your eyes looked. Glasses, lighting and camera position affect it. These numbers
          describe where you faced, not how confident, engaged or employable you are, and they're for your own practice.
        </p>
      </details>
    </Card>
  );
}
