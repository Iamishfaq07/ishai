import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, PlugZap, cx, focusRing } from "@orbit/ui";
import { Button, Card, ErrorNote, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";

type State = "looking" | "found" | "missing" | "connecting" | "connected";

/**
 * Connect the Orbit browser extension (apps/extension): makes a sign-in that only works for the extension (clip a
 * job, check a page's keywords, read the autofill basics) and hands it to the extension on this page. It's listed in
 * Settings → Devices as "Browser extension", where it can be signed out. The token is never shown.
 */
export function ExtensionConnectPage() {
  const [state, setState] = useState<State>("looking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string } | null;
      if (data?.source !== "orbit-extension") return;
      if (data.type === "ready") setState((s) => (s === "looking" || s === "missing" ? "found" : s));
      if (data.type === "connected") setState("connected");
    };
    window.addEventListener("message", onMessage);
    // Ask whether the extension's script is on this page; it answers "ready". A few times: it can load after us.
    const ping = () => window.postMessage({ source: "orbit-web", type: "ping" }, window.location.origin);
    ping();
    const again = window.setInterval(ping, 400);
    const t = window.setTimeout(() => {
      window.clearInterval(again);
      setState((s) => (s === "looking" ? "missing" : s));
    }, 2500);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(again);
      window.clearTimeout(t);
    };
  }, []);

  const connect = async () => {
    setError(null);
    setState("connecting");
    try {
      const { token } = await api.extensionConnect();
      window.postMessage({ source: "orbit-web", type: "extension-token", token }, window.location.origin);
    } catch (err) {
      setError(errorText(err));
      setState("found");
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader icon={PlugZap} title="Connect the browser extension" subtitle="Clip jobs from any site and fill applications faster, from Chrome or Edge." />
      <Card>
        <h2 className="font-display text-base font-semibold">What it can do</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
          <li>Save the job you're looking at to your tracker, after you check the title and company.</li>
          <li>Show which of the job's keywords your resume already mentions (no AI, no credits).</li>
          <li>Fill an application's empty name, email, phone and link fields from your resume, outlined for you to check.</li>
        </ul>
        <h2 className="mt-4 font-display text-base font-semibold">What it can't do</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
          <li>Submit an application, or answer questions that are yours to answer (salary, visa, why this company).</li>
          <li>Read a page unless you click the extension on it, or see anything else in your Orbit account.</li>
        </ul>
        <div className="mt-5">
          {state === "connected" ? (
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <Check className="h-4 w-4" aria-hidden /> Connected. Click the Orbit icon in your browser's toolbar on any job page.
            </p>
          ) : state === "missing" ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              The extension isn't on this browser yet, or this page wasn't opened from it. Install it, then press its{" "}
              <strong>Connect to Orbit</strong> button.
            </p>
          ) : (
            <Button onClick={() => void connect()} disabled={state === "connecting" || state === "looking"}>
              {state === "connecting" ? "Connecting…" : state === "looking" ? "Looking for the extension…" : "Connect the extension"}
            </Button>
          )}
          {error && (
            <div className="mt-3">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
        </div>
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          It shows up in{" "}
          <Link to="/settings#devices" className={cx("rounded underline", focusRing)}>
            Settings → Devices
          </Link>{" "}
          as "Browser extension". Sign it out there any time.
        </p>
      </Card>
    </div>
  );
}
