import { useEffect, useId, useMemo, useRef, useState } from "react";
import { encode } from "uqr";
import type { ApiClient } from "../api/client";
import { Check, Copy, Smartphone, X } from "../icons";
import { trimTrailingSlashes } from "../serverUrl";
import { cx, focusRing } from "./cx";
import { Button } from "./ui";

type CompanionApi = Pick<ApiClient, "startCompanion" | "stopCompanion">;

/** The phone link. The code rides in the #fragment, so it never reaches a server log or a Referer header. */
export function companionLink(webUrl: string, code: string): string {
  return `${trimTrailingSlashes(webUrl)}/companion#${code}`;
}

/** A QR code as crisp SVG modules (dark on a white quiet zone, in both themes, so every phone camera reads it). */
export function QrCode({ value, size = 176, label }: { value: string; size?: number; label: string }) {
  const qr = useMemo(() => encode(value, { ecc: "M", border: 2 }), [value]);
  const path = useMemo(() => {
    let d = "";
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x},${y}h1v1h-1z`;
      }),
    );
    return d;
  }, [qr]);
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      shapeRendering="crispEdges"
      className="rounded-xl"
    >
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={path} fill="#09090b" />
    </svg>
  );
}

/**
 * "Phone": show a QR code that opens a read-only second screen of this session on a phone — the live question and
 * answer, nothing captured there. Shared by the web and desktop live panels (passed as the panel's `headerEnd`;
 * the popover anchors to the panel, not the button, so it fits the narrow desktop window).
 */
export function CompanionShare({
  api,
  sessionId,
  webUrl,
  disabled = false,
}: {
  api: CompanionApi;
  sessionId: string;
  /** Where the web app lives: the phone opens `<webUrl>/companion#<code>`. */
  webUrl: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const popId = useId();

  const link = code ? companionLink(webUrl, code) : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setCode((await api.startCompanion(sessionId)).code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create a phone link.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !code && !busy) void start();
  };

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.stopCompanion(sessionId);
      setCode(null);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't stop sharing.");
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    if (!link) return;
    // Refused (no permission) or missing (insecure page): say so rather than fail silently.
    const done = (ok: boolean) => {
      setError(ok ? null : "Couldn't copy the link: the browser blocked the clipboard. Scan the QR code instead.");
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    };
    if (!navigator.clipboard) return done(false);
    navigator.clipboard.writeText(link).then(
      () => done(true),
      () => done(false),
    );
  };

  return (
    <span ref={rootRef}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={popId}
        title={code ? "Your phone can follow this session" : "Follow this session on your phone"}
        className={cx(
          "tap-y inline-flex items-center gap-1 rounded-lg p-1.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-40 dark:hover:bg-white/5 dark:hover:text-zinc-200",
          code && "text-indigo-600 dark:text-indigo-300",
          focusRing,
        )}
      >
        <Smartphone className="h-4 w-4" />
        <span className="sr-only">Phone companion</span>
        {code && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />}
      </button>
      {open && (
        <div
          id={popId}
          role="dialog"
          aria-label="Follow on your phone"
          className="glass-panel absolute right-2 top-12 z-40 w-72 max-w-[calc(100%-1rem)] animate-fade-up rounded-2xl p-4 text-left text-zinc-900 shadow-popover dark:text-zinc-100"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-display text-sm font-semibold">Follow on your phone</p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                Scan with your phone’s camera to see each question and answer there. Read-only — nothing is
                recorded on the phone.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className={cx("-mr-1 -mt-1 rounded-md p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200", focusRing)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 flex justify-center">
            {link ? (
              <QrCode value={link} label="QR code for the phone link" />
            ) : (
              <div
                className="flex h-[176px] w-[176px] items-center justify-center rounded-xl bg-zinc-500/10 text-xs text-zinc-500"
                role="status"
              >
                {busy ? "Creating a link…" : "No link yet"}
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="mt-3 text-xs text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {link ? (
              <>
                <Button variant="secondary" size="sm" onClick={copy}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy link"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void stop()} disabled={busy}>
                  Stop sharing
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => void start()} disabled={busy}>
                {busy ? "Creating…" : "Try again"}
              </Button>
            )}
          </div>
          {link && (
            <p className="mt-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              Anyone with this link can watch until the session ends. Stop sharing to disconnect every phone.
            </p>
          )}
        </div>
      )}
    </span>
  );
}
