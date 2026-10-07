import { useEffect, useRef, useState } from "react";
import { cx } from "./cx";

/**
 * Loading placeholders shaped like what's coming (a job card, a resume, a session row) instead of a spinner, with
 * the timing that keeps them from flickering: `useLoadPhase(loading)` waits 150 ms before showing one (a fast load
 * never flashes it) and, once shown, keeps it at least 300 ms (no blink).
 *
 *   const phase = useLoadPhase(loading);
 *   if (phase === "skeleton") return <Skeleton variant="job-card" count={3} label="Finding your matches" />;
 *   if (phase === "pending") return null;
 */
export type LoadPhase = "pending" | "skeleton" | "done";
export interface LoadTiming {
  /** ms of loading before the placeholder appears. */
  delay?: number;
  /** ms the placeholder stays once it has appeared. */
  minimum?: number;
}

/** The timing without React (tested in Skeleton.test.ts): call `update(loading)` on every change. */
export function createLoadPhase(onChange: (phase: LoadPhase) => void, { delay = 150, minimum = 300 }: LoadTiming = {}) {
  let phase: LoadPhase = "done";
  let loading = false;
  let shownAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const go = (next: LoadPhase) => {
    if (next === phase) return;
    phase = next;
    onChange(next);
  };
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    update(next: boolean): void {
      if (next === loading) return;
      loading = next;
      if (loading) {
        // Back to loading while a shown placeholder was finishing its minimum: it simply stays.
        if (phase === "skeleton") return clear();
        go("pending");
        timer = setTimeout(() => {
          timer = undefined;
          shownAt = Date.now();
          go("skeleton");
        }, delay);
        return;
      }
      clear();
      const left = phase === "skeleton" ? minimum - (Date.now() - shownAt) : 0;
      if (left <= 0) return go("done");
      timer = setTimeout(() => {
        timer = undefined;
        go("done");
      }, left);
    },
    phase: () => phase,
    dispose: clear,
  };
}

/** `pending` (loading, too soon for a placeholder: render nothing new), `skeleton`, or `done` (show the content). */
export function useLoadPhase(loading: boolean, { delay = 150, minimum = 300 }: LoadTiming = {}): LoadPhase {
  const [phase, setPhase] = useState<LoadPhase>(loading ? "pending" : "done");
  const control = useRef<ReturnType<typeof createLoadPhase> | null>(null);
  useEffect(() => {
    const c = createLoadPhase(setPhase, { delay, minimum });
    control.current = c;
    return () => {
      c.dispose();
      control.current = null;
    };
  }, [delay, minimum]);
  useEffect(() => control.current?.update(loading), [loading, delay, minimum]);
  return phase;
}

export type SkeletonVariant = "line" | "card" | "job-card" | "resume-card" | "session-row";

/** One placeholder bar, a line of text high unless `className` sets a height. It shimmers at Full motion only;
 *  Gentle and Off get a still tint. */
export function SkeletonLine({ className = "", still }: { className?: string; still?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cx("skeleton-line", !/(^|\s)h-/.test(className) && "h-3", still ? "skeleton-still" : "motion-ok:animate-shimmer", className)}
    />
  );
}

const WIDTHS = ["w-11/12", "w-4/5", "w-full", "w-3/4", "w-5/6"];
const panel = "glass-panel rounded-2xl";

function Shape({ variant, i, still }: { variant: SkeletonVariant; i: number; still: boolean }) {
  const bar = (className?: string) => <SkeletonLine still={still} className={className} />;
  switch (variant) {
    case "line":
      return bar(WIDTHS[i % WIDTHS.length]);
    case "card":
      return (
        <div className={cx(panel, "space-y-3 p-5")}>
          {bar("h-4 w-1/3")}
          {bar("w-full")}
          {bar(WIDTHS[i % WIDTHS.length])}
          {bar("w-2/3")}
        </div>
      );
    case "job-card":
      // Title, company and place, when; the match badge; two lines of summary; the actions.
      return (
        <div className={cx(panel, "p-5")}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2.5">
              {bar(cx("h-4", i % 2 ? "w-2/3" : "w-1/2"))}
              {bar("w-2/5")}
              {bar("h-2.5 w-1/4")}
            </div>
            {bar("h-12 w-12 rounded-xl")}
          </div>
          <div className="mt-4 space-y-2">
            {bar("w-11/12")}
            {bar("w-3/4")}
          </div>
          <div className="mt-4 flex gap-2">
            {bar("h-8 w-20 rounded-xl")}
            {bar("h-8 w-16 rounded-xl")}
            {bar("h-8 w-24 rounded-xl")}
          </div>
        </div>
      );
    case "resume-card":
      // A page thumbnail beside the title, when it changed and its score.
      return (
        <div className={cx(panel, "flex gap-4 p-4")}>
          <div className="flex aspect-[3/4] w-16 shrink-0 flex-col gap-1.5 rounded-md border border-zinc-200 bg-white p-2 dark:border-white/10 dark:bg-white/5">
            {bar("h-1.5 w-2/3")}
            {bar("h-1 w-full")}
            {bar("h-1 w-5/6")}
            {bar("mt-1 h-1 w-full")}
            {bar("h-1 w-3/4")}
          </div>
          <div className="flex-1 space-y-2.5 py-1">
            {bar(cx("h-4", i % 2 ? "w-1/2" : "w-2/3"))}
            {bar("w-1/3")}
            {bar("mt-3 h-6 w-20")}
          </div>
        </div>
      );
    case "session-row":
      return (
        <div className={cx(panel, "flex items-center justify-between gap-4 px-6 py-5")}>
          <div className="flex-1 space-y-2">
            {bar(cx("h-4", i % 2 ? "w-28" : "w-40"))}
            {bar("w-48 max-w-full")}
          </div>
          <div className="flex flex-col items-end gap-2">
            {bar("w-32")}
            {bar("w-20")}
          </div>
        </div>
      );
  }
}

/**
 * `count` placeholders of one shape, announced once to screen readers as `label` ("Loading…"). `ghost` draws them
 * still and silent, as the faded preview in a first-use empty state.
 */
export function Skeleton({
  variant = "line",
  count = 1,
  label = "Loading",
  ghost = false,
  className,
}: {
  variant?: SkeletonVariant;
  count?: number;
  label?: string;
  ghost?: boolean;
  className?: string;
}) {
  return (
    <div
      {...(ghost ? { "aria-hidden": true } : { role: "status" })}
      className={cx(variant === "line" ? "space-y-2.5" : "space-y-3", className)}
    >
      {!ghost && <span className="sr-only">{label.replace(/[.…]+$/, "")}…</span>}
      {Array.from({ length: count }, (_, i) => (
        <Shape key={i} variant={variant} i={i} still={ghost} />
      ))}
    </div>
  );
}

export type GhostKind = "cards" | "list" | "columns";

/**
 * Ghost skeletons: the outline of a filled screen, for a first-use EmptyState's `preview`: `cards` (two cards: resumes, matches),
 * `list` (rows: sessions, documents) or `columns` (the tracker's saved / applied / interviewing, one card each).
 */
export function GhostPreview({ kind = "cards" }: { kind?: GhostKind }) {
  const card = (lines: string[], key?: number) => (
    <div key={key} className="space-y-2 rounded-xl border border-dashed border-zinc-300 p-3 text-left dark:border-white/20">
      {lines.map((w, i) => (
        <SkeletonLine key={i} still className={cx(i === 0 ? "h-2.5" : "h-2", w)} />
      ))}
    </div>
  );
  if (kind === "columns")
    return (
      <div className="grid grid-cols-3 gap-3">
        {["w-1/2", "w-2/5", "w-3/5"].map((w, i) => (
          <div key={i} className="space-y-2 rounded-xl bg-zinc-500/5 p-2 dark:bg-white/[0.05]">
            <SkeletonLine still className={cx("mx-1 my-1 h-2", w)} />
            {card(["w-3/4", "w-1/2"])}
          </div>
        ))}
      </div>
    );
  if (kind === "list")
    return (
      <div className="space-y-2">
        {["w-2/5", "w-1/3", "w-1/2"].map((w, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-3 py-2.5 dark:border-white/20">
            <span className="h-6 w-6 shrink-0 rounded-full border border-dashed border-zinc-300 dark:border-white/20" />
            <div className="flex-1 space-y-1.5">
              <SkeletonLine still className={cx("h-2.5", w)} />
              <SkeletonLine still className="h-2 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {card(["w-1/2", "w-11/12", "w-3/4", "w-1/3"], 0)}
      <div className="hidden sm:block">{card(["w-2/3", "w-5/6", "w-2/3", "w-1/4"])}</div>
    </div>
  );
}
