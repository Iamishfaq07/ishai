import { useState } from "react";
import type { CreditPack } from "@orbit/types";
import { Sheet } from "@orbit/ui";
import { Button, ErrorNote } from "./ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";

export function InternationalCheckout({ pack, country, onClose, onDomestic }: {
  pack: CreditPack; country: string; onClose: () => void; onDomestic: () => void;
}) {
  const [mode, setMode] = useState<"international" | "inr">("international");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ reference: string; message: string } | null>(null);
  const claim = async () => {
    setBusy(true); setError(null);
    try { setReceipt(await api.requestLaunchAccess(pack.id, country)); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  return <Sheet open title="Choose your launch access" onClose={onClose} size="lg">
    <div className="space-y-5 p-5">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Checkout region">
        <Button variant={mode === "international" ? "primary" : "secondary"} onClick={() => setMode("international")}>International access</Button>
        <Button variant={mode === "inr" ? "primary" : "secondary"} onClick={() => setMode("inr")}>INR checkout</Button>
      </div>
      {mode === "international" ? <>
        <p>International cards are awaiting gateway approval. Reserve a launch access request for the {pack.label} pack.</p>
        <p className="text-sm text-zinc-500">No payment is taken. Our team reviews your request in Orbit's Inbox; credits are added after approval.</p>
        {receipt ? <p role="status" className="rounded-xl bg-emerald-500/10 p-4">{receipt.message}<br /><strong className="tabular-nums">{receipt.reference}</strong></p>
          : <Button disabled={busy} onClick={() => void claim()}>{busy ? "Reserving…" : "Request launch access"}</Button>}
      </> : <>
        <p className="tabular-nums">{pack.label} · {pack.price_text ?? `₹${pack.price_inr.toLocaleString("en-IN")}`}</p>
        <p className="text-sm text-zinc-500">Use UPI or a card issued in India. Your bank may convert the charge; international cards may still be declined.</p>
        <Button onClick={onDomestic}>Continue with INR</Button>
      </>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  </Sheet>;
}
