/**
 * Region selector: a transparent, always-on-top window covering the current monitor.
 * Drag a rectangle → the overlay hides itself → Rust captures and crops the monitor →
 * preview with Analyze / Retake / Cancel. Nothing leaves the machine until Analyze.
 * With "Scroll to the end" on, Rust scrolls the area under the selection to the bottom and joins the screens, so
 * a problem longer than the screen arrives whole; it scrolls it back afterwards.
 */
import { StrictMode, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createRoot } from "react-dom/client";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { safeLocal } from "@orbit/ui";
import {
  REGION_CAPTURED_EVENT,
  captureRegion,
  captureScreen,
  captureScrolling,
  type NativeCapture,
  type RegionCapturedPayload,
  type ScrollCapture,
} from "./native";
import { isScrolled, scrollNote } from "./scrollNote";
import "./index.css";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SIZE = 8;

function normalize(ax: number, ay: number, bx: number, by: number): Rect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SCROLL_PREF = "orbit.scrollCapture";
const loadScrollPref = () => safeLocal.getItem(SCROLL_PREF) === "1";

function Overlay() {
  const win = getCurrentWindow();
  const start = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [capture, setCapture] = useState<NativeCapture | ScrollCapture | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scroll, setScroll] = useState(loadScrollPref);
  /** The last selection, for "Scroll to the end" from the preview. */
  const lastRect = useRef<Rect | null>(null);

  const toggleScroll = () => {
    const on = !scroll;
    setScroll(on);
    safeLocal.setItem(SCROLL_PREF, on ? "1" : "0");
  };

  const close = useCallback(() => void win.close(), [win]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  /** Hide first so the overlay itself never appears in the capture. */
  const grab = async (fn: () => Promise<NativeCapture>) => {
    setBusy(true);
    setError(null);
    try {
      await win.hide();
      await sleep(150);
      setCapture(await fn());
    } catch (err) {
      setError(String(err));
    } finally {
      await win.show();
      await win.setFocus();
      setBusy(false);
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (capture || busy) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
    setRect({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    setRect(normalize(start.current.x, start.current.y, e.clientX, e.clientY));
  };
  const onPointerUp = () => {
    const r = rect;
    start.current = null;
    if (!r || r.width < MIN_SIZE || r.height < MIN_SIZE) {
      setRect(null);
      return;
    }
    lastRect.current = r;
    void grab(() => (scroll ? captureScrolling(r) : captureRegion(r)));
  };

  const scrollLast = () => {
    const r = lastRect.current;
    if (!r) return;
    setCapture(null);
    void grab(() => captureScrolling(r));
  };

  const analyze = async () => {
    if (!capture) return;
    const payload: RegionCapturedPayload = { pngBase64: capture.pngBase64 };
    await emitTo("main", REGION_CAPTURED_EVENT, payload);
    close();
  };

  const retake = () => {
    setCapture(null);
    setRect(null);
  };

  if (capture) {
    const scrolled = isScrolled(capture);
    const note = scrolled ? scrollNote(capture) : null;
    // A joined capture is tall: shown at full width and scrolled in the preview, not shrunk to a sliver.
    const tall = capture.height > capture.width * 1.6;
    return (
      <div className="flex h-full items-center justify-center bg-black/60 p-8">
        <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 text-zinc-100 shadow-2xl">
          <div className="max-h-[70vh] min-h-0 flex-1 overflow-auto p-3">
            <img
              src={`data:image/png;base64,${capture.pngBase64}`}
              alt="Selected area"
              className={tall ? "mx-auto w-full max-w-[640px] rounded-lg" : "mx-auto max-h-[70vh] rounded-lg"}
            />
          </div>
          {note && (
            <p role="status" className="border-t border-zinc-800 px-3 py-2 text-xs text-amber-200">
              {note}
            </p>
          )}
          <div className="flex items-center gap-2 border-t border-zinc-800 p-3 text-xs">
            <span className="text-zinc-500">
              {scrolled && capture.screens > 1 ? `${capture.screens} screens joined · ` : ""}
              {capture.width}×{capture.height}
            </span>
            <button type="button" onClick={() => void analyze()} className="ml-auto rounded-lg bg-indigo-600 px-3 py-1.5 font-medium hover:bg-indigo-500">
              Analyze
            </button>
            {!scrolled && lastRect.current && (
              <button
                type="button"
                onClick={scrollLast}
                title="Scroll this area to the end and capture all of it"
                className="rounded-lg px-3 py-1.5 hover:bg-zinc-800"
              >
                Scroll to the end
              </button>
            )}
            <button type="button" onClick={retake} className="rounded-lg px-3 py-1.5 hover:bg-zinc-800">
              Retake
            </button>
            <button type="button" onClick={close} className="rounded-lg px-3 py-1.5 text-zinc-400 hover:bg-zinc-800">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative h-full cursor-crosshair select-none bg-black/25"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {!rect && (
        <div className="pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 rounded-full bg-zinc-950/90 px-4 py-2 text-sm text-zinc-100 shadow-lg">
          {scroll
            ? "Drag over the problem: Orbit scrolls it to the end and joins it · keep the mouse still · Esc to cancel"
            : "Drag to select an area · Esc to cancel"}
        </div>
      )}
      <div className="absolute right-6 top-6 flex gap-2" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          role="switch"
          aria-checked={scroll}
          disabled={busy}
          onClick={toggleScroll}
          title="For problems longer than the screen: Orbit scrolls the selected area to the end and captures all of it"
          className={`rounded-lg px-3 py-1.5 text-xs ${scroll ? "bg-indigo-600 text-white hover:bg-indigo-500" : "bg-zinc-950/90 text-zinc-100 hover:bg-zinc-800"}`}
        >
          Scroll to the end: {scroll ? "On" : "Off"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            lastRect.current = null; // nothing to scroll: the preview offers no "Scroll to the end"
            void grab(captureScreen);
          }}
          className="rounded-lg bg-zinc-950/90 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-800"
        >
          Capture full screen
        </button>
        <button type="button" onClick={close} className="rounded-lg bg-zinc-950/90 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-800">
          Cancel
        </button>
      </div>
      {rect && (
        <div
          className="pointer-events-none absolute border-2 border-indigo-400 bg-indigo-400/10"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        />
      )}
      {error && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-lg bg-rose-950/90 px-4 py-2 text-sm text-rose-100">{error}</div>
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Overlay />
    </StrictMode>,
  );
}
