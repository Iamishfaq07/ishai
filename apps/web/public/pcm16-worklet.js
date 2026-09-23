/**
 * AudioWorklet: mono-mix → low-pass → linear resample to 16 kHz → PCM16.
 * Posts { pcm: ArrayBuffer (Int16 samples), rms: number } every ~50 ms.
 * `sampleRate` is the AudioContext rate (global in AudioWorkletGlobalScope).
 */
const TARGET_RATE = 16000;
const FRAME_SAMPLES = 800; // 50 ms at 16 kHz

class Pcm16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE;
    this.pos = 0;
    this.prev = 0;
    this.hasPrev = false;
    // One-pole low-pass tuned below the 8 kHz Nyquist of the target rate.
    const cutoff = 7000;
    this.alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    this.lp = 0;
    this.out = new Int16Array(FRAME_SAMPLES);
    this.outLen = 0;
    this.sumSq = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    const channels = input.length;
    const frames = input[0].length;

    for (let i = 0; i < frames; i++) {
      let mono = 0;
      for (let c = 0; c < channels; c++) mono += input[c][i];
      mono /= channels;

      this.lp += this.alpha * (mono - this.lp);
      const sample = this.step > 1 ? this.lp : mono;

      if (!this.hasPrev) {
        this.prev = sample;
        this.hasPrev = true;
        continue;
      }
      while (this.pos < 1) {
        const v = this.prev + (sample - this.prev) * this.pos;
        this.emit(v);
        this.pos += this.step;
      }
      this.pos -= 1;
      this.prev = sample;
    }
    return true;
  }

  emit(v) {
    const clamped = Math.max(-1, Math.min(1, v));
    this.out[this.outLen++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    this.sumSq += clamped * clamped;
    if (this.outLen === FRAME_SAMPLES) {
      const pcm = this.out.slice(0).buffer;
      const rms = Math.sqrt(this.sumSq / FRAME_SAMPLES);
      this.port.postMessage({ pcm, rms }, [pcm]);
      this.outLen = 0;
      this.sumSq = 0;
    }
  }
}

registerProcessor("pcm16-processor", Pcm16Processor);
