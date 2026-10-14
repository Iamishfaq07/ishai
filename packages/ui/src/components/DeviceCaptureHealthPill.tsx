export type CaptureHealth = "active" | "recovering" | "muted";
const labels: Record<CaptureHealth, string> = { active: "Capture active", recovering: "Recovering device…", muted: "Capture muted" };
const tones: Record<CaptureHealth, string> = {
  active: "border-emerald-500/25 text-emerald-700 dark:text-emerald-300",
  recovering: "border-amber-500/25 text-amber-800 dark:text-amber-200",
  muted: "border-zinc-500/20 text-zinc-500 dark:text-zinc-400",
};
export function DeviceCaptureHealthPill({ audio, screen = "muted" }: { audio: CaptureHealth; screen?: CaptureHealth }) {
  return <span role="status" aria-live="polite" aria-label={labels[audio]} title={`Audio: ${audio}. Screen: ${screen === "muted" ? "on demand" : screen}.`}
    className={`telemetry inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-zinc-500/5 px-2 py-1 text-[10px] transition-colors motion-reduce:transition-none ${tones[audio]}`}>
    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" /><span className="hidden sm:inline">{labels[audio]}</span>
    {screen === "active" && <span className="hidden border-l border-current/20 pl-1.5 sm:inline">Screen captured</span>}
  </span>;
}
