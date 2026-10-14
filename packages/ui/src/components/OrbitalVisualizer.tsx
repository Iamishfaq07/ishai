import { useEffect, useRef } from "react";
import { useMotion } from "../hooks/useMotion";

export type OrbitalState = "idle" | "listening" | "thinking" | "streaming";
export function orbitalState(state: string): OrbitalState {
  if (state === "generating" || state === "question_detected") return "thinking";
  if (state === "streaming") return "streaming";
  if (["listening", "speech_detected", "answer_complete"].includes(state)) return "listening";
  return "idle";
}

/** An audio-reactive core without a second audio context or per-frame React updates. */
export function OrbitalVisualizer({ state = "idle", analyser, amplitude, size = 64 }: {
  state?: OrbitalState; analyser?: AnalyserNode; amplitude?: () => number; size?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const motion = useMotion();
  const input = useRef({ analyser, amplitude });
  useEffect(() => { input.current = { analyser, amplitude }; }, [analyser, amplitude]);
  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    element.width = size * dpr; element.height = size * dpr;
    ctx.scale(dpr, dpr);
    let frame = 0;
    let visible = true;
    let level = 0;
    let wave = new Float32Array(256);
    const render = (time: number) => {
      frame = 0;
      const active = visible && !document.hidden;
      const phase = motion === "full" && active ? time / 1000 : 0;
      let rms = input.current.amplitude?.() ?? 0;
      const source = input.current.analyser;
      if (source && state === "listening" && active) {
        if (wave.length !== source.fftSize) wave = new Float32Array(source.fftSize);
        source.getFloatTimeDomainData(wave);
        rms = Math.sqrt(wave.reduce((sum, n) => sum + n * n, 0) / wave.length);
      }
      level += (Math.min(1, Math.max(0, rms) * 5) - level) * 0.18;
      ctx.clearRect(0, 0, size, size);
      ctx.save(); ctx.translate(size / 2, size / 2);
      const radius = size * (0.32 + (state === "listening" ? level * 0.1 : 0));
      const colour = ctx.createLinearGradient(-radius, -radius, radius, radius);
      colour.addColorStop(0, "#38BDF8"); colour.addColorStop(1, "#6366F1");
      ctx.strokeStyle = colour; ctx.lineWidth = Math.max(1, size / 48);
      for (let i = 0; i < 2; i += 1) {
        ctx.save(); ctx.rotate(phase * (i ? -0.32 : 0.25) + i * Math.PI / 2);
        ctx.beginPath(); ctx.ellipse(0, 0, radius + i * size * 0.06, radius * 0.56, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(radius + i * size * 0.06, 0, size * 0.025, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      const working = state === "thinking" || state === "streaming";
      const pulse = working ? (Math.sin(phase * 3.4) + 1) / 2 : 0;
      ctx.globalAlpha = 0.75; ctx.fillStyle = colour;
      ctx.beginPath(); ctx.arc(0, 0, size * (working ? 0.105 - pulse * 0.02 : 0.085), 0, Math.PI * 2); ctx.fill();
      if (working) {
        ctx.globalAlpha = 0.5 * (1 - pulse); ctx.beginPath();
        ctx.arc(0, 0, size * (0.12 + pulse * 0.22), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      if (motion === "full" && active) frame = requestAnimationFrame(render);
    };
    const resume = () => { if (!frame) render(performance.now()); };
    const observer = new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting); resume(); });
    observer.observe(element);
    document.addEventListener("visibilitychange", resume);
    render(0);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener("visibilitychange", resume); };
  }, [motion, state, size]);
  return <canvas ref={canvas} style={{ width: size, height: size }} className="shrink-0" role="img" aria-label={`Orbit AI ${state}`} />;
}
