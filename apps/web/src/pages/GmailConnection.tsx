import { useState } from "react";
import { Button, Card, ErrorNote } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
export function GmailConnection() {
  const state = useAsync(() => api.call<{ configured: boolean; connected: boolean; email: string | null }>("/v1/gmail"), [], "gmail-connection");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (disconnect = false) => {
    setBusy(true); setError("");
    try {
      if (disconnect) { await api.call("/v1/gmail", { method: "DELETE" }); state.reload(); }
      else { const result = await api.call<{ url: string }>("/v1/gmail/connect", { method: "POST" }); window.location.assign(result.url); }
    } catch { setError("Could not update Gmail. Verify your email and try again."); }
    finally { setBusy(false); }
  };
  return <Card className="space-y-3"><h2 className="font-semibold">Gmail application emails</h2>
    <p className="text-sm">Connect Gmail to send reviewed application emails from an opportunity. Each email needs your confirmation. Orbit requests sending permission, not inbox reading.</p>
    {state.data?.connected ? <><p>{state.data.email}</p><Button disabled={busy} variant="secondary" onClick={() => void act(true)}>Disconnect Gmail</Button><p className="text-xs">Disconnect removes Orbit’s stored access. You can also revoke the grant in your Google account’s third-party access settings.</p></>
      : <Button disabled={busy || !state.data?.configured} onClick={() => void act()}>Connect Gmail</Button>}
    {state.data && !state.data.configured && <p className="text-sm">Gmail is awaiting server OAuth configuration.</p>}
    {(error || state.error) && <ErrorNote>{error || "Could not load Gmail connection."}</ErrorNote>}
  </Card>;
}
