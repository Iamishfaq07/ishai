import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { cx, focusRing } from "./cx";

const CORNERS = ["tl", "tr", "bl", "br"] as const;
const CORNER_PATH: Record<(typeof CORNERS)[number], string> = {
  tl: "M1 11V4a3 3 0 0 1 3-3h7",
  tr: "M1 1h7a3 3 0 0 1 3 3v7",
  bl: "M1 1v7a3 3 0 0 0 3 3h7",
  br: "M11 1v7a3 3 0 0 1-3 3H1",
};
const CORNER_PLACE: Record<(typeof CORNERS)[number], string> = {
  tl: "left-2 top-2",
  tr: "right-2 top-2",
  bl: "bottom-2 left-2",
  br: "bottom-2 right-2",
};

/**
 * A ring that fills with `progress` (0–1), or spins as an open arc while the amount isn't known (a single fetch
 * reports no upload progress). The spin stops with reduced motion; the ring is then just a ring.
 */
export function ProgressRing({ progress, size = 28, className }: { progress?: number; size?: number; className?: string }) {
  const r = 10;
  const length = 2 * Math.PI * r;
  const known = typeof progress === "number";
  const filled = known ? Math.min(1, Math.max(0, progress)) : 0.28;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="progressbar"
      aria-label="Uploading"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(known ? { "aria-valuenow": Math.round(filled * 100) } : {})}
      className={cx(!known && "animate-spin", className)}
    >
      <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - filled)}
        transform="rotate(-90 12 12)"
        style={{ transition: "stroke-dashoffset 200ms ease-out" }}
      />
    </svg>
  );
}

/**
 * A file drop area: corner brackets draw in toward the middle while a file is dragged over it (base.css
 * .drop-bracket), and a progress ring shows while `busy`. Clicking or pressing Enter/Space opens the file picker.
 */
export function Dropzone({
  accept,
  disabled,
  busy,
  progress,
  file,
  onFile,
  hint,
  className,
}: {
  accept?: string;
  disabled?: boolean;
  busy?: boolean;
  progress?: number;
  file: File | null;
  onFile: (file: File | null) => void;
  hint?: ReactNode;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const off = disabled || busy;
  const over = (e: DragEvent) => {
    if (off || !Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (off) return;
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  };
  return (
    <div
      role="button"
      tabIndex={off ? -1 : 0}
      aria-disabled={off || undefined}
      aria-label={file ? `Chosen file: ${file.name}. Choose another file` : "Choose a file or drop it here"}
      data-dragging={dragging || undefined}
      onClick={() => !off && input.current?.click()}
      onKeyDown={(e) => {
        if (!off && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragEnter={over}
      onDragOver={over}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={drop}
      className={cx(
        "relative flex min-h-[7.5rem] flex-col items-center justify-center gap-2 rounded-2xl px-6 py-5 text-center text-xs transition-colors",
        dragging ? "bg-sky-500/10 text-sky-700 dark:text-sky-300" : "bg-zinc-500/5 text-zinc-500 dark:text-zinc-400",
        off ? "cursor-default opacity-80" : "cursor-pointer hover:bg-zinc-500/10",
        focusRing,
        className,
      )}
    >
      {CORNERS.map((c) => (
        <svg
          key={c}
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={cx("drop-bracket pointer-events-none absolute h-4 w-4", `drop-bracket--${c}`, CORNER_PLACE[c], dragging ? "text-sky-500" : "text-zinc-400/70")}
        >
          <path d={CORNER_PATH[c]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ))}
      {busy ? (
        <ProgressRing progress={progress} className="text-sky-500" />
      ) : (
        <span className="font-medium text-zinc-700 dark:text-zinc-200">{dragging ? "Drop it here" : file ? file.name : "Drop a file here, or click to choose"}</span>
      )}
      {hint && <span>{hint}</span>}
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        disabled={off}
        onClick={(e) => e.stopPropagation()} // its click bubbles to the zone, which would open the picker again
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
    </div>
  );
}
