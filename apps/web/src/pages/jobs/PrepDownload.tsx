import { useState } from "react";
import { Button, ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { downloadText, prepPackHtml, type PrepPack } from "../../lib/prepPack";

export function PrepDownload({ entryId }: { entryId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const download = async () => {
    setBusy(true); setError("");
    try { downloadText("orbit-interview-prep.html", prepPackHtml(await api.call<PrepPack>(`/v1/career/prep-pack/${entryId}`))); }
    catch { setError("Could not download your preparation. Connect and try again."); }
    finally { setBusy(false); }
  };
  return <div className="my-3"><Button variant="secondary" loading={busy} onClick={() => void download()}>Download offline prep</Button>
    <p className="mt-1 text-xs text-zinc-500">Private job notes, current resume content and saved questions. Opens offline and can be printed.</p>
    {error && <ErrorNote>{error}</ErrorNote>}</div>;
}
