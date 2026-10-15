import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AnswerView } from "../live/reducer";
import { cx, focusRing } from "./cx";
import { safeLocal } from "../storage";

export interface TeleprompterProps {
  answer: AnswerView | null;
}

const STORAGE_KEY = "orbit.teleprompter";

interface PrompterPrefs {
  fontSize: number;
  width: number;
  speed: number;
}

function loadPrefs(): PrompterPrefs {
  try {
    const raw = safeLocal.getItem(STORAGE_KEY);
    if (raw) return { fontSize: 28, width: 70, speed: 20, ...(JSON.parse(raw) as Partial<PrompterPrefs>) };
  } catch {
    // ignore
  }
  return { fontSize: 28, width: 70, speed: 20 };
}

/**
 * Reading mode: large short lines, one highlighted bullet at a time.
 * Auto-scroll is opt-in, slow, and stops the moment the user scrolls manually.
 */
export function Teleprompter({ answer }: TeleprompterProps) {
  const [prefs, setPrefs] = useState<PrompterPrefs>(loadPrefs);
  const [current, setCurrent] = useState(0);
  const [autoScroll, setAutoScroll] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const answerId = answer?.answer_id ?? null;

  const lines = answer
    ? [...answer.answer.direct_answer.split(/\n{2,}/), ...answer.answer.talking_points].filter((l) => l.trim().length > 0)
    : [];

  useEffect(() => {
    safeLocal.setItem(STORAGE_KEY, JSON.stringify(prefs));
  }, [prefs]);

  useEffect(() => {
    setCurrent(0);
    setAutoScroll(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [answerId]);

  useEffect(() => {
    if (!autoScroll) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    let frame = 0;
    let last = performance.now();
    let carry = 0;
    const step = (t: number) => {
      const el = scrollRef.current;
      if (el) {
        carry += ((t - last) / 1000) * prefs.speed;
        const whole = Math.floor(carry);
        if (whole > 0) {
          el.scrollTop += whole;
          carry -= whole;
        }
      }
      last = t;
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [autoScroll, prefs.speed]);

  const stopAuto = () => setAutoScroll(false);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setCurrent((c) => Math.min(c + 1, Math.max(0, lines.length - 1)));
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setCurrent((c) => Math.max(0, c - 1));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800">
        <label className="flex items-center gap-1.5">
          Size
          <input
            type="range"
            min={18}
            max={48}
            value={prefs.fontSize}
            onChange={(e) => setPrefs({ ...prefs, fontSize: Number(e.target.value) })}
            aria-label="Font size"
          />
        </label>
        <label className="flex items-center gap-1.5">
          Width
          <input
            type="range"
            min={40}
            max={100}
            value={prefs.width}
            onChange={(e) => setPrefs({ ...prefs, width: Number(e.target.value) })}
            aria-label="Text width"
          />
        </label>
        <label className="flex items-center gap-1.5">
          Speed
          <input
            type="range"
            min={5}
            max={80}
            value={prefs.speed}
            onChange={(e) => setPrefs({ ...prefs, speed: Number(e.target.value) })}
            aria-label="Auto-scroll speed"
          />
        </label>
        <button
          type="button"
          aria-pressed={autoScroll}
          onClick={() => setAutoScroll((v) => !v)}
          className={cx("rounded px-2 py-0.5 font-medium", autoScroll && "bg-indigo-500/15 text-indigo-600", focusRing)}
        >
          {autoScroll ? "Stop scroll" : "Auto-scroll"}
        </button>
      </div>

      <div
        ref={scrollRef}
        onWheel={stopAuto}
        onTouchMove={stopAuto}
        onKeyDown={onKeyDown}
        tabIndex={0}
        aria-label="Teleprompter — use arrow keys to move between lines"
        className={cx("min-h-0 flex-1 overflow-y-auto py-6", focusRing)}
      >
        {lines.length === 0 ? (
          <p className="px-6 text-center text-zinc-500">The next answer will appear here in reading mode.</p>
        ) : (
          <ol className="mx-auto space-y-5 px-6" style={{ maxWidth: `${prefs.width}ch` }}>
            {lines.map((line, i) => (
              <li
                key={i}
                onClick={() => setCurrent(i)}
                style={{ fontSize: `${prefs.fontSize}px` }}
                className={cx(
                  "cursor-pointer leading-tight transition-opacity motion-reduce:transition-none",
                  i === current ? "font-semibold text-zinc-900 opacity-100 dark:text-white" : "text-zinc-600 opacity-60 dark:text-zinc-300",
                )}
              >
                {line}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
