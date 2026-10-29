import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { MentorReview } from "@orbit/types";
import { cx, focusRing, safeLocal } from "@orbit/ui";
import { Button, ErrorNote, Input, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { PublicLayout } from "../marketing/PublicLayout";

const NAME_KEY = "orbit.mentor.name";

function readName(): string {
  try {
    return safeLocal.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * /review/:token — what a mentor sees when a candidate asks for feedback (mentor.py): the mock interview's report as
 * it was when the link was made, and a box under each answer (and one for the whole interview) for their comments.
 * No account; the link is the access, and it expires.
 */
export function MentorReviewPage() {
  const { token = "" } = useParams();
  const [review, setReview] = useState<MentorReview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [name, setName] = useState(readName);

  useEffect(() => {
    api.mentorReview(token).then(setReview, (err: unknown) => setFailed(errorText(err)));
  }, [token]);

  const send = async (item: number | null, body: string) => {
    try {
      safeLocal.setItem(NAME_KEY, name.trim());
    } catch {
      /* private mode */
    }
    setReview(await api.mentorComment(token, { author: name.trim(), body, item }));
  };

  if (failed) {
    return (
      <PublicLayout context="Mentor review">
        <div className="mx-auto max-w-xl px-4 py-24 text-center">
          <h1 className="font-display text-2xl font-semibold">This link doesn't open</h1>
          <p className="mt-3 text-zinc-600 dark:text-zinc-300">{failed}</p>
        </div>
      </PublicLayout>
    );
  }
  if (!review) return <PublicLayout context="Mentor review"><p className="py-24 text-center" role="status">Opening the report…</p></PublicLayout>;

  const r = review.report;
  const whose = r.first_name ? `${r.first_name}'s` : "A";
  const about = [r.role, r.company].filter(Boolean).join(" at ");
  return (
    <PublicLayout context="Mentor review">
      <div className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6">
        <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Feedback requested</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">{whose} mock interview{about ? `: ${about}` : ""}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Practised on {new Date(`${r.date}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" })} with Orbit's AI interviewer. {r.first_name || "They"} asked you to look it over: leave a note on any answer, or
          on the whole interview. They'll see what you write. This link stops working on {new Date(review.expires_at).toLocaleDateString()}.
        </p>

        <label className="mt-6 block max-w-sm text-sm">
          <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Your name (shown with your comments)</span>
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Priya" className="mt-1" />
        </label>

        <section aria-labelledby="overall" className="mt-8 rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
          <h2 id="overall" className="font-display text-lg font-semibold">
            Overall{r.overall_score != null ? `: ${r.overall_score}/5 from the AI` : ""}
          </h2>
          {r.strengths.length > 0 && <p className="mt-2 text-sm"><span className="font-medium">Strengths: </span>{r.strengths.join("; ")}</p>}
          {r.improvements.length > 0 && <p className="mt-1 text-sm"><span className="font-medium">To improve: </span>{r.improvements.join("; ")}</p>}
          {r.delivery?.words_per_minute != null && (
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Pace {Math.round(r.delivery.words_per_minute)} words a minute
              {r.delivery.fillers_per_minute != null ? ` · ${r.delivery.fillers_per_minute.toFixed(1)} filler words a minute` : ""}
            </p>
          )}
          <Comments review={review} item={null} />
          <CommentBox label="Your note on the whole interview" disabled={!name.trim()} onSend={(body) => send(null, body)} />
        </section>

        <ol className="mt-6 space-y-5">
          {r.items.map((it, i) => (
            <li key={i} className="rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Question {i + 1}{it.score != null ? ` · AI score ${it.score}/5` : " · not answered"}</p>
              <h3 className="mt-1 font-semibold">{it.question}</h3>
              {it.you_said !== undefined && (
                <blockquote className="mt-3 border-l-2 border-zinc-300 pl-3 text-sm text-zinc-700 dark:border-white/20 dark:text-zinc-300">
                  {it.you_said || "(No answer)"}
                </blockquote>
              )}
              {it.feedback && <p className="mt-3 text-sm"><span className="font-medium">AI feedback: </span>{it.feedback}</p>}
              {it.better && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400"><span className="font-medium">A stronger version: </span>{it.better}</p>}
              <Comments review={review} item={i} />
              <CommentBox label={`Your note on question ${i + 1}`} disabled={!name.trim()} onSend={(body) => send(i, body)} />
            </li>
          ))}
        </ol>
        {!r.answers_included && (
          <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">{r.first_name || "They"} shared the questions, scores and feedback, not their answers.</p>
        )}
        <p className="mt-10 text-xs text-zinc-500 dark:text-zinc-400">
          Orbit is an interview practice app. <Link to="/" className={cx("rounded underline", focusRing)}>What Orbit does</Link>
        </p>
      </div>
    </PublicLayout>
  );
}

function Comments({ review, item }: { review: MentorReview; item: number | null }) {
  const mine = review.comments.filter((c) => c.item === item);
  if (!mine.length) return null;
  return (
    <ul className="mt-3 space-y-2">
      {mine.map((c, i) => (
        <li key={i} className="rounded-xl bg-indigo-500/5 p-3 text-sm ring-1 ring-indigo-500/15">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{c.author}</span>
          <p className="mt-0.5 whitespace-pre-line">{c.body}</p>
        </li>
      ))}
    </ul>
  );
}

function CommentBox({ label, disabled, onSend }: { label: string; disabled: boolean; onSend: (body: string) => Promise<void> }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSend(body.trim());
      setBody("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3">
      <label className="block text-sm">
        <span className="sr-only">{label}</span>
        <Textarea value={body} rows={2} maxLength={2000} onChange={(e) => setBody(e.target.value)} placeholder={label} />
      </label>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" disabled={busy || disabled || body.trim().length < 2} onClick={() => void submit()}>{busy ? "Sending…" : "Add note"}</Button>
        {disabled && <span className="text-xs text-zinc-500 dark:text-zinc-400">Add your name above first.</span>}
      </div>
      {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}
    </div>
  );
}
