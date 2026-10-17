import { memo, useMemo } from "react";
import type { Speaker } from "@orbit/types";
import type { TurnView } from "../live/reducer";
import { TranscriptLog, type TranscriptLine } from "./TranscriptLog";

export interface TranscriptViewProps {
  turns: TurnView[];
  /** Optional speaker correction (mixed-channel diarization mistakes). */
  onCorrectSpeaker?: (turnId: string, speaker: Speaker) => void;
}

/**
 * The live copilot's transcript (its Transcript tab): the conversation as it's heard, following the newest line while
 * you're at the bottom and staying put while you read back (TranscriptLog). Memoized: it only changes when the turns
 * do, not on every other live update (an answer streaming in).
 */
export const TranscriptView = memo(function TranscriptView({ turns, onCorrectSpeaker }: TranscriptViewProps) {
  const lines = useMemo<TranscriptLine[]>(
    () => turns.map((t) => ({ id: t.turn_id, speaker: t.speaker, text: t.text, final: t.final, at: t.start_ms != null ? t.start_ms / 1000 : null })),
    [turns],
  );
  return <TranscriptLog lines={lines} tone="panel" {...(onCorrectSpeaker ? { onCorrectSpeaker } : {})} />;
});
