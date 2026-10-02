import { useEffect, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { cx, focusRing } from "./cx";

export interface ScreenshotPreviewProps {
  image: Blob;
  onAnalyze: () => Promise<void>;
  onRetake: () => void;
  onCancel: () => void;
}

/** Capture → preview → explicit send. Nothing is uploaded until the user presses Analyze. */
export function ScreenshotPreview({ image, onAnalyze, onRetake, onCancel }: ScreenshotPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A modal over the panel: focus starts on Analyze, Tab stays inside, Escape cancels (not mid-upload).
  const dialogRef = useFocusTrap<HTMLDivElement>(true, { onEscape: () => !busy && onCancel() });

  useEffect(() => {
    const objectUrl = URL.createObjectURL(image);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [image]);

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      await onAnalyze();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t send the screenshot.");
      setBusy(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot preview"
      className="absolute inset-0 z-20 flex flex-col bg-white/95 dark:bg-zinc-950/95"
    >
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {url && <img src={url} alt="Captured screenshot" className="mx-auto max-h-full rounded-lg border border-zinc-200 dark:border-zinc-800" />}
      </div>
      {error && <p className="px-3 pb-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => void analyze()}
          disabled={busy}
          className={cx("rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50", focusRing)}
        >
          {busy ? "Sending…" : "Analyze"}
        </button>
        <button type="button" onClick={onRetake} disabled={busy} className={cx("rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800", focusRing)}>
          Retake
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={cx("ml-auto rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800", focusRing)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
