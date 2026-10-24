import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, ErrorNote } from "../../components/ui";
import { flagAllows } from "../../components/flags";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { downloadText } from "../../lib/prepPack";

export function ProjectEvidence({ title, excerpt }: { title: string; excerpt: string }) {
  const { user } = useAuth();
  const [claim, setClaim] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!confirmed || claim.trim().length < 3 || busy || saved) return;
    setBusy(true); setError("");
    try {
      await api.call("/v1/evidence", { method: "POST", body: JSON.stringify({ claim: claim.trim() }) });
      setSaved(true);
    } catch { setError("Could not save this claim. Check your evidence vault before retrying if the connection was interrupted."); }
    finally { setBusy(false); }
  };
  const rehearsal = () => downloadText("orbit-project-interview.txt", `${title}\n\nYour practice work\n${excerpt}\n\nInterview rehearsal\n1. Explain the problem in 30 seconds.\n2. Describe exactly what you personally did.\n3. Explain one test and its actual result.\n4. What changed when the requirement changed?\n5. What tradeoff did you make?\n6. What would you improve next?\n\nWrite your answer and a concrete example for each question. Label synthetic practice clearly; do not describe it as paid or production work.\n`, "text/plain");
  return <Card className="space-y-3"><h3 className="font-semibold">Use this project in your preparation</h3>
    <Button variant="secondary" onClick={rehearsal}>Download project interview worksheet</Button>
    {flagAllows(user, "evidence_vault") && <>
      <p className="text-sm">Write one factual claim about your own contribution. Identify this as synthetic practice. Saving adds your claim to the evidence vault for reuse during preparation; it does not certify your skills.</p>
      <label className="block text-sm font-medium">Claim to add to my evidence vault<textarea className="mt-2 min-h-24 w-full rounded-lg border border-zinc-300 bg-transparent p-3 dark:border-white/20" maxLength={300} value={claim} disabled={busy || saved} onChange={(e) => { setClaim(e.target.value); setConfirmed(false); }} /></label>
      <p className="text-xs text-zinc-500">Only this claim is saved to the vault. Your full project, private notes and reviewer links are not copied.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy || saved} onChange={(e) => setConfirmed(e.target.checked)} />I reviewed this claim and it accurately describes my own work.</label>
      <Button disabled={!confirmed || claim.trim().length < 3 || busy || saved} onClick={() => void save()}>{saved ? "Added to evidence vault" : busy ? "Saving claim…" : "Save reviewed evidence claim"}</Button>
      {saved && <p role="status" className="text-sm">Claim saved. <Link to="/documents/evidence" className="underline">Review or remove it in the evidence vault</Link>.</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </>}
  </Card>;
}
