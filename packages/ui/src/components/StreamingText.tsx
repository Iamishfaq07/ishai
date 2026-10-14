import { useRef } from "react";

/**
 * How streamed text splits into pieces: what was already shown stays as it was, and each new piece that arrived is
 * its own entry (it fades in from a light blur, base.css .stream-chunk). Older pieces fold into the first entry so a
 * long answer keeps a handful of spans, not hundreds. Text that isn't a continuation (a new answer, an edit) starts
 * over as one settled piece, with no animation.
 */
export function nextChunks(previous: readonly string[], text: string, keep = 6): string[] {
  const shown = previous.join("");
  if (!shown) return text ? ["", text] : []; // the first piece animates in too
  if (!text.startsWith(shown)) return text ? [text] : [];
  const tail = text.slice(shown.length);
  if (!tail) return [...previous];
  const chunks = [...previous, tail];
  return chunks.length > keep ? [chunks.slice(0, chunks.length - keep + 1).join(""), ...chunks.slice(-(keep - 1))] : chunks;
}

/** Text that grows while an answer streams: each newly arrived piece decompresses in (180 ms); the rest stays put. */
export function StreamingText({ text, live }: { text: string; live: boolean }) {
  const chunks = useRef<string[]>([]);
  if (!live) {
    chunks.current = text ? [text] : [];
    return <>{text}</>;
  }
  chunks.current = nextChunks(chunks.current, text);
  let offset = 0;
  return (
    <>
      {chunks.current.map((chunk, i) => {
        const start = offset;
        offset += chunk.length;
        // Keyed by where the piece starts in the text, so folding older pieces never replays an animation.
        return i === 0 ? (
          <span key="settled">{chunk}</span>
        ) : (
          <span key={start} className="stream-chunk">
            {chunk}
          </span>
        );
      })}
    </>
  );
}
