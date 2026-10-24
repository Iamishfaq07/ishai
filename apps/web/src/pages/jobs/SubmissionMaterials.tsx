import { useState } from "react";
import { Button, ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { downloadText } from "../../lib/prepPack";
interface Materials { available: boolean; note: string; observation?: string; recorded_at?: string; digest?: string; integrity_matches?: boolean; content?: unknown }
export function SubmissionMaterials({ snapshotId }: { snapshotId: string }) {
  const [view, setView] = useState<Materials | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setBusy(true); setError("");
    try { setView(await api.call<Materials>(`/v1/career/submission-materials/${snapshotId}`)); }
    catch { setError("Could not load captured materials."); }
    finally { setBusy(false); }
  };
  return <div className="w-full text-sm"><Button size="sm" variant="ghost" loading={busy} onClick={() => void load()}>Inspect captured application materials</Button>
    {error && <ErrorNote>{error}</ErrorNote>}
    {view && <div className="mt-2 space-y-2 rounded-lg bg-zinc-500/5 p-3"><p>{view.note}</p>
      {view.available && <><p>Source: {view.observation} · recorded {view.recorded_at}</p>
        <p role="status">{view.integrity_matches ? "Stored content matches its captured hash." : "Content hash mismatch. Treat this record as inconsistent."}</p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(view.content, null, 2)}</pre>
        <Button size="sm" variant="secondary" onClick={() => downloadText("orbit-captured-materials.json", JSON.stringify(view, null, 2), "application/json")}>Download captured record</Button></>}
    </div>}
  </div>;
}
