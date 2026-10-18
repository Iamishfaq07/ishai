/**
 * The microphone's audio while the AI interviewer can be heard (DECISIONS D76): held back, since her voice comes
 * back through the speakers and would be transcribed as the candidate's, but the last PREROLL_MS of it is kept. When
 * the candidate talks over her (barge-in), that's sent first: it took about 300 ms of their voice to know they were
 * talking, and without it the start of what they said was lost ("So there was a case where…" came out as "…scan of
 * findings"). When she simply finishes, the held audio (her own last words) is dropped.
 */
export const PREROLL_MS = 900;

export interface MicGate {
  /** One frame of the mic's PCM16 (16 kHz mono); `held` while she can be heard. */
  frame(pcm: Int16Array, held: boolean): void;
  /** The candidate just talked over her: the held audio goes out with the next frame. */
  bargeIn(): void;
}

export function createMicGate(send: (pcm: Int16Array) => void, sampleRate = 16_000, prerollMs = PREROLL_MS): MicGate {
  const keep = Math.round((sampleRate * prerollMs) / 1000);
  let held: Int16Array[] = [];
  let heldSamples = 0;
  let flush = false;
  return {
    frame(pcm, isHeld) {
      if (!isHeld) {
        if (flush) for (const f of held) send(f);
        held = [];
        heldSamples = 0;
        flush = false;
        send(pcm);
        return;
      }
      held.push(pcm);
      heldSamples += pcm.length;
      while (held.length > 1 && heldSamples - held[0]!.length >= keep) heldSamples -= held.shift()!.length;
    },
    bargeIn() {
      flush = true;
    },
  };
}
