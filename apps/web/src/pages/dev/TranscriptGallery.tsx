import { useEffect, useRef, useState } from "react";
import { Button, TranscriptLog, VideoRoomTranscript, type TranscriptLine } from "@orbit/ui";

const SABA = [
  "Tell me about a time you disagreed with a teammate on a technical decision.",
  "How did you settle it, and what would you do differently now?",
  "What's the difference between an index scan and a sequential scan?",
  "When would the planner choose a hash join over a nested loop?",
];
const YOU = [
  "Sure. On the payments team we disagreed about blocking builds on scanner findings.",
  "I suggested we start in report-only mode for two weeks and agree a threshold from the data.",
  "An index scan reads only the matching rows through the index, a sequential scan reads the whole table.",
  "For a large unsorted input with an equality join, a hash join usually wins.",
  "That's right.",
];

/** A fake conversation for the gallery: lines added at once, or one heard word by word and then finished. */
function useFakeTranscript() {
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const n = useRef(0);
  const timer = useRef(0);
  useEffect(() => () => window.clearInterval(timer.current), []);
  const at = () => 12 + n.current * 7;
  const add = (count: number) =>
    setLines((prev) => {
      const next = [...prev];
      for (let i = 0; i < count; i++) {
        const k = n.current++;
        const saba = k % 3 === 0;
        next.push({ id: `l${k}`, speaker: saba ? "interviewer" : "candidate", text: saba ? SABA[k % SABA.length]! : YOU[k % YOU.length]!, final: true, at: at() });
      }
      return next;
    });
  const stream = () => {
    window.clearInterval(timer.current);
    const k = n.current++;
    const id = `l${k}`;
    const words = YOU[k % YOU.length]!.split(" ");
    let w = 0;
    setLines((prev) => [...prev, { id, speaker: "candidate", text: "", final: false, at: at() }]);
    timer.current = window.setInterval(() => {
      w += 1;
      const done = w >= words.length;
      setLines((prev) => prev.map((l) => (l.id === id ? { ...l, text: words.slice(0, w).join(" "), final: done } : l)));
      if (done) window.clearInterval(timer.current);
    }, 140);
  };
  return { lines, add, stream, clear: () => setLines([]) };
}

/**
 * The transcripts (TranscriptLog): the video room's panel and drawer, and the copilot's panel, with fake lines, so
 * following, reading back with the "Jump to latest" chip, and a line still being heard can all be tried.
 */
export function TranscriptDemo() {
  const room = useFakeTranscript();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => room.add(9), []); // eslint-disable-line react-hooks/exhaustive-deps -- once, a conversation to start
  return (
    <section aria-labelledby="g-transcript" className="space-y-4">
      <h2 id="g-transcript" className="font-display text-lg font-semibold">
        Transcript (video interview and copilot)
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => room.add(1)}>
          Add a line
        </Button>
        <Button size="sm" variant="secondary" onClick={() => room.add(120)}>
          Add 120 lines
        </Button>
        <Button size="sm" variant="secondary" onClick={room.stream}>
          Hear a line
        </Button>
        <Button size="sm" variant="ghost" onClick={room.clear}>
          Clear
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="video-room dark flex h-[26rem] flex-col gap-3 rounded-3xl bg-zinc-950 p-3 text-zinc-100" data-transcript-demo="side">
          <VideoRoomTranscript lines={room.lines} interviewer="Saba" variant="side" open onOpenChange={() => undefined} className="min-h-0 flex-1" />
        </div>
        <div className="flex flex-col gap-4">
          <div className="video-room dark flex flex-col justify-end gap-2 rounded-3xl bg-zinc-950 p-3 text-zinc-100" data-transcript-demo="drawer">
            <p className="text-xs text-zinc-400">On a phone: a drawer above the controls, folded to the latest line.</p>
            <VideoRoomTranscript lines={room.lines} interviewer="Saba" variant="drawer" open={drawer} onOpenChange={setDrawer} />
          </div>
          <div className="flex h-64 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-white/10 dark:bg-zinc-950" data-transcript-demo="panel">
            <TranscriptLog lines={room.lines} tone="panel" />
          </div>
        </div>
      </div>
    </section>
  );
}
