import { useState } from "react";
import { Button, ErrorNote } from "../../../components/ui";
import { api } from "../../../lib/api";
import { errorText } from "../../../lib/format";

interface Review {
  version: string; source: "mock" | "ai";
  facts: Array<{ id: string; label: string; text: string }>;
  tips: Array<{ fact_id: string; source_quote: string; suggestion: string; success_check: string }>;
}

export default function ApplicationReview({ id, revision }: { id: string; revision: string }) {
  const [result, setResult] = useState<{ revision: string; review: Review } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const review = result?.revision === revision ? result.review : null;
  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const path = `/v1/apply/packets/${encodeURIComponent(id)}/review`;
      const source = await api.call<{ version: string }>(path);
      const next = await api.call<Review>(path, { method: "POST", body: JSON.stringify({ version: source.version }), timeoutMs: 70_000 });
      setResult({ revision, review: next });
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  return <section aria-label="AI application second reader" className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-400/20 dark:bg-indigo-500/5">
    <h3 className="font-semibold">A second reader for your application</h3>
    <p className="text-sm text-zinc-600 dark:text-zinc-400">Compare the saved posting, your source resume and the prepared application. Advice includes exact source quotes. Review suggestions yourself before editing your resume or answers.</p>
    <Button variant="secondary" loading={busy} loadingText="Reading your materials…" onClick={() => void run()}>Review with AI</Button>
    <p className="text-xs text-zinc-500">Up to 5 reviews per UTC day, including failed attempts. Advisory only; this does not pause, edit or approve a queued application.</p>
    <div aria-live="polite">
      {error && <ErrorNote>{error}</ErrorNote>}
      {review && <><p className="mt-3 text-xs font-semibold">{review.source === "mock" ? "Demo response · mock provider" : "AI suggestions · check against your records"}</p>
        <ul className="mt-3 space-y-4">{review.tips.map((tip) => <li key={tip.fact_id} className="space-y-2 text-sm">
          <p className="font-medium">{tip.suggestion}</p>
          <blockquote className="border-l-2 border-indigo-300 pl-3 text-zinc-600 dark:text-zinc-400">“{tip.source_quote}”</blockquote>
          <p className="text-xs text-zinc-500">Source: {review.facts.find((f) => f.id === tip.fact_id)?.label}</p>
          <p><span className="font-medium">Check:</span> {tip.success_check}</p>
        </li>)}</ul></>}
    </div>
  </section>;
}
