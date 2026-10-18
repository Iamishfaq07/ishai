import { useId } from "react";
import type { Speaker } from "@orbit/types";
import { ChevronDown, ChevronUp, Copy, PanelRightClose, ScrollText } from "../icons";
import { cx, focusRing } from "./cx";
import { Tooltip } from "./Menu";
import { toast } from "./Toast";
import { SPEAKER_NAMES, TranscriptLog, transcriptText, type TranscriptLine } from "./TranscriptLog";

/** Saba's small mark beside her name: three voice bars on an accent disc (a voice, not a face). */
export function SabaMark() {
  return (
    <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center gap-[1.5px] rounded-full bg-indigo-400/25">
      {[5, 8, 5].map((h, i) => (
        <span key={i} className="w-[2px] rounded-full bg-indigo-200" style={{ height: h }} />
      ))}
    </span>
  );
}

function HeaderButton({ label, onClick, children, expanded, controls }: { label: string; onClick: () => void; children: React.ReactNode; expanded?: boolean; controls?: string }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        {...(expanded !== undefined ? { "aria-expanded": expanded } : {})}
        {...(controls ? { "aria-controls": controls } : {})}
        className={cx(
          "flex h-8 w-8 items-center justify-center rounded-lg text-zinc-300 transition-[background-color,color,transform] duration-quick hover:bg-white/10 hover:text-white motion-ok:active:scale-[0.96]",
          focusRing,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * The video room's transcript: what Saba asked and what you answered, as a conversation (TranscriptLog), in a panel
 * with its count, Copy and a way to fold it away. Beside the call on wide screens ("side"); on phones and tablets a
 * drawer between the call and its controls ("drawer"), folded to one line (the latest words) until opened, so it
 * never covers the buttons.
 */
export function VideoRoomTranscript({
  lines,
  interviewer,
  variant,
  open,
  onOpenChange,
  className,
}: {
  lines: TranscriptLine[];
  /** The interviewer's name (Saba). */
  interviewer: string;
  variant: "side" | "drawer";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}) {
  const id = useId();
  const names: Record<Speaker, string> = { ...SPEAKER_NAMES, interviewer };
  const finals = lines.filter((l) => l.final).length;
  const count = `${finals} line${finals === 1 ? "" : "s"}`;
  const latest = lines[lines.length - 1];
  const copy = () => {
    const text = transcriptText(lines, names);
    if (!text) return toast("Nothing to copy yet");
    void navigator.clipboard?.writeText(text).then(
      () => toast("Transcript copied"),
      () => toast({ message: "Couldn't copy the transcript", tone: "error" }),
    );
  };

  if (variant === "drawer" && !open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-expanded={false}
        aria-controls={id}
        className={cx(
          "flex w-full items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-2.5 text-left ring-1 ring-white/10 transition-colors duration-quick hover:bg-zinc-800/80",
          focusRing,
          className,
        )}
      >
        <ScrollText className="h-4 w-4 shrink-0 text-zinc-300" aria-hidden />
        <span className="shrink-0 text-sm font-medium text-zinc-100">Transcript</span>
        <span className="shrink-0 text-xs tabular-nums text-zinc-400">· {count}</span>
        <span aria-hidden="true" className="min-w-0 flex-1 truncate text-xs text-zinc-400">
          {latest ? `${names[latest.speaker]}: ${latest.text}` : ""}
        </span>
        <ChevronUp className="h-4 w-4 shrink-0 text-zinc-300" aria-hidden />
      </button>
    );
  }

  return (
    <section
      id={id}
      aria-label="Interview transcript"
      className={cx(
        "flex min-h-0 flex-col overflow-hidden rounded-3xl bg-zinc-900 ring-1 ring-white/10",
        variant === "drawer" ? "h-[min(42dvh,22rem)] animate-rise" : "animate-panel-in",
        className,
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] py-2 pl-4 pr-2">
        <ScrollText className="h-4 w-4 text-zinc-300" aria-hidden />
        <h2 className="text-sm font-medium text-zinc-100">Transcript</h2>
        <span className="text-xs tabular-nums text-zinc-400">· {count}</span>
        <span className="flex-1" />
        <HeaderButton label="Copy the transcript" onClick={copy}>
          <Copy className="h-4 w-4" aria-hidden />
        </HeaderButton>
        <HeaderButton label={variant === "side" ? "Hide the transcript" : "Fold the transcript"} onClick={() => onOpenChange(false)} expanded={true}>
          {variant === "side" ? <PanelRightClose className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </HeaderButton>
      </header>
      <TranscriptLog
        lines={lines}
        tone="room"
        names={names}
        mark={<SabaMark />}
        label="Interview transcript"
        empty={`What ${interviewer} asks and what you answer appears here.`}
      />
    </section>
  );
}
