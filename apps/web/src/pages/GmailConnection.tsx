import { useState } from "react";
import { Button, Card, ErrorNote } from "../components/ui";
import { api } from "../lib/api";
import { useGmail } from "../lib/useGmail";
export function GmailConnection() {
  const state = useGmail();
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
  // Not set up on this server yet: nothing to connect, so nothing to show.
  if (state.data && !state.data.configured) return null;
  return <Card className="space-y-3"><h2 className="font-semibold">Gmail application emails</h2>
    <p className="text-sm">Connect Gmail to send application emails from your own address. You review and approve every email before it goes. Orbit can only send; it can't read your inbox.</p>
    {state.data?.connected ? <><p>{state.data.email}</p><Button disabled={busy} variant="secondary" onClick={() => void act(true)}>Disconnect Gmail</Button><p className="text-xs">Disconnecting removes Orbit's access to your Gmail, here and in your Google account.</p></>
      : <Button disabled={busy || !state.data?.configured} onClick={() => void act()}>Connect Gmail</Button>}
    {(error || state.error) && <ErrorNote>{error || "Could not load Gmail connection."}</ErrorNote>}
  </Card>;
}
