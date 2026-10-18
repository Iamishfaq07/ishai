import { Check, Circle, Copy, Ellipsis, FileText, Laptop, Maximize2, Minus, MonitorSmartphone, PhoneOff, X, cx, LIVE_LANGUAGES, OrbitLogo, CodeBlock, languageName } from "@orbit/ui";
import { Chips, FakeButton, Panel, TickRows, Typed, at, typedWords, useClock, useNear, usePlay } from "../marketing/kit";

/**
 * The interview copilot's public page, drawn with the copilot's own pieces (DECISIONS D79): the live answer card's
 * parts (key points, the sources it used, Shorter/Longer/Simpler), the real code block (CodeBlock), the Windows app's
 * compact window, and the languages the server's live sessions know (LIVE_LANGUAGES, live_language.py). Sample data:
 * a made-up candidate and company, as on the front page's live answer.
 */

/** Step 1: the documents a session uses, each ticking in. */
export function DocsStepArt() {
  const p = usePlay<HTMLDivElement>();
  const rows = [
    { label: "Resume", note: "Product analyst, 3 roles" },
    { label: "Job description", note: "Pasted from the post" },
    { label: "2 stories", note: "For “Tell me about a time”" },
  ];
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label="A session's documents: the resume, the job description and two stories." className="kp w-full max-w-[17rem]">
      <Panel title="Documents" meta="this session">
        <TickRows className="p-3" rows={rows} times={rows.map((_, i) => 250 + i * 300)} />
      </Panel>
    </div>
  );
}

/** Step 2: where Orbit listens, the tab or the call app, with a meter that moves while it hears it. */
export function ListenStepArt() {
  const p = usePlay<HTMLDivElement>();
  const tiles = [
    { icon: Laptop, name: "Meeting tab", note: "Chrome or Edge", on: true },
    { icon: MonitorSmartphone, name: "Any call app", note: "Orbit for Windows", on: false },
  ];
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label="Where Orbit listens: a Chrome or Edge meeting tab, or any call app with Orbit for Windows." className="kp grid w-full max-w-[17rem] grid-cols-2 gap-2">
      {tiles.map(({ icon: Icon, name, note, on }) => (
        <div key={name} className={cx("rounded-xl border mk-surface p-2.5", on ? "border-indigo-500/50 ring-1 ring-indigo-500/30" : "mk-line")}>
          <Icon className="h-4 w-4 text-zinc-600 dark:text-zinc-300" aria-hidden="true" />
          <p className="mt-2 text-[0.75rem] font-medium text-zinc-900 dark:text-zinc-100">{name}</p>
          <p className="text-[0.6875rem] text-zinc-500 dark:text-zinc-400">{note}</p>
          <span aria-hidden="true" className="mt-2 flex h-3 items-end gap-[3px]">
            {[0.5, 0.9, 0.6, 1, 0.7].map((h, i) => (
              <span key={i} className={cx("w-1 origin-bottom rounded-full", on ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600", on && p.play && "mk-listen")} style={{ height: `${h * 100}%`, animationDelay: `${i * 0.12}s`, animationIterationCount: 4 }} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

const Q = "Why do you want to work on payments?";
const A = "Because the work I'm proudest of was in checkout: at Lumen I cut a six-step flow to two and trial-to-paid went up 12%.";

/** Step 3: the question, recognised, and the answer arriving under it. */
export function AnswerStepArt() {
  const p = usePlay<HTMLDivElement>();
  const t = useClock(p.shown, p.play, 3200);
  const typed = typedWords(A, t, 700, 80);
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`The interviewer's question, recognised: "${Q}" Then a suggested answer: "${A}"`} className="kp w-full max-w-[17rem] space-y-2">
      <div className="kp-in rounded-xl border mk-line mk-surface px-3 py-2" style={at(100, { y: 6 })}>
        <p className="flex items-center gap-1 text-[0.625rem] font-medium text-zinc-500 dark:text-zinc-400">
          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} aria-hidden="true" /> Question · Motivation
        </p>
        <p className="mt-0.5 text-[0.75rem] font-medium text-zinc-950 dark:text-white">{Q}</p>
      </div>
      <div className="rounded-xl bg-indigo-500/[0.045] px-3 py-2 ring-1 ring-inset ring-indigo-500/15 dark:bg-indigo-400/[0.06] dark:ring-indigo-300/15">
        <p className="text-[0.625rem] font-medium text-indigo-700 dark:text-indigo-300">Answer</p>
        <Typed className="mt-0.5 text-[0.75rem] leading-relaxed text-zinc-800 dark:text-zinc-100" text={A} shown={typed.shown} typing={typed.typing} />
      </div>
    </div>
  );
}

// ─── The toolkit ───────────────────────────────────────────────────────────────────────────────────────────────────

const SOURCES = [
  { label: "Resume · Lumen Analytics: Product analyst, 2023 to now", verified: true },
  { label: "Resume: Cut mobile onboarding from 6 screens to 2, +12% trial-to-paid", verified: true },
  { label: "Story: The pricing test that failed first", verified: true },
];

/** Sources: the lines of your documents an answer used, ticking in, and a detail it suggests marked as an example. */
export function SourcesArt() {
  const p = usePlay<HTMLDivElement>();
  const times = SOURCES.map((_, i) => 300 + i * 260);
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`An answer's sources: ${SOURCES.map((s) => s.label).join("; ")}. A detail not in the documents is marked as a suggested example to swap.`} className="kp space-y-3">
      <div className="rounded-xl bg-indigo-500/[0.045] p-3 ring-1 ring-inset ring-indigo-500/15 dark:bg-indigo-400/[0.06] dark:ring-indigo-300/15">
        <p className="text-[0.75rem] leading-relaxed text-zinc-800 dark:text-zinc-100">
          I split the funnel by device and found setup took six screens on mobile. We tested a two-screen flow, and trial-to-paid went up 12%. I'd also{" "}
          <mark className="kp-lit rounded-sm bg-amber-400/25 px-0.5 text-amber-950 dark:text-amber-100" style={at(1200)}>
            [check retention after 30 days]
          </mark>{" "}
          next time.
        </p>
        <p className="kp-fade mt-2 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[0.6875rem] font-medium text-amber-900 dark:text-amber-200" style={at(1300)}>
          Suggested details: swap in your own
        </p>
      </div>
      <TickRows rows={SOURCES.map((s) => ({ label: s.label }))} times={times} />
    </div>
  );
}

/** The ten languages (and Hinglish) a live session can be in, from the app's own list, coming on one by one. Named in
 *  English (languageName): the picker's own scripts would each fetch a font for this one card. */
export function LanguagesArt() {
  const p = usePlay<HTMLDivElement>();
  const langs = LIVE_LANGUAGES.filter((l) => l.value !== "auto").map((l) => languageName(l.value));
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`Interview languages: ${langs.join(", ")}, or auto-detect.`} className="kp">
      <p className="text-[0.6875rem] font-medium text-zinc-600 dark:text-zinc-300">Interview language</p>
      <Chips className="mt-2" from={200} every={80} items={langs.map((label) => ({ label, on: true }))} />
      <p className="kp-fade mt-3 text-[0.6875rem] text-zinc-500 dark:text-zinc-400" style={at(1300)}>
        Or Auto-detect: it follows the interviewer across languages, even mid-interview. Answers come in the same language, or one you pick.
      </p>
    </div>
  );
}

const LONG = "At Lumen I saw most trial users left before connecting their first data source. I split the funnel by device, found setup took six screens on mobile, and made the case to cut it to two. Trial-to-paid went up 12% that quarter.";
const SHORT = "At Lumen I cut mobile setup from six screens to two, and trial-to-paid went up 12% that quarter.";

/** Shorter, in one tap: the answer rewritten in place. */
export function RewriteArt() {
  const p = usePlay<HTMLDivElement>();
  const t = useClock(p.shown, p.play, 3600);
  const pressed = t >= 900 && t < 1150;
  const short = t >= 1200;
  const typed = typedWords(SHORT, t, 1300, 85);
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label="An answer made shorter in one tap: the medium answer, rewritten as two lines that keep its numbers." className="kp">
      <div className="flex flex-wrap gap-1.5">
        {["Shorter", "Longer", "Simpler"].map((x) => (
          <FakeButton key={x} className={cx("transition-transform duration-press-out", x === "Shorter" && (short ? "border-indigo-500/60 text-indigo-700 dark:text-indigo-300" : ""), x === "Shorter" && pressed && "scale-[0.97]")}>
            {x}
          </FakeButton>
        ))}
      </div>
      <div className="relative mt-3 rounded-xl bg-indigo-500/[0.045] p-3 ring-1 ring-inset ring-indigo-500/15 dark:bg-indigo-400/[0.06] dark:ring-indigo-300/15">
        <p className="text-[0.625rem] font-medium text-indigo-700 dark:text-indigo-300">{short ? "Short answer" : "Medium answer"}</p>
        <div className="relative mt-1 text-[0.75rem] leading-relaxed text-zinc-800 dark:text-zinc-100">
          {/* The longer text keeps the box's height, so nothing below moves when the shorter one comes in. */}
          <p className={cx(short && "invisible")}>{LONG}</p>
          {short && (
            <p className="absolute inset-0">
              {typed.shown}
              {typed.typing && <span className="mk-caret" />}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const CODE = `def has_duplicate(nums):
  seen = set()
  for n in nums:
    if n in seen:
      return True
    seen.add(n)
  return False`;

/** A coding question: what to say first, the code (the real code block, with Copy and Wrap), its complexity. */
export function CodeArt() {
  // The code font comes with the code block, once it's near the screen (the built HTML keeps a placeholder).
  const [ref, near] = useNear<HTMLDivElement>();
  return (
    <div ref={ref} className="space-y-2.5">
      <p className="text-[0.75rem] leading-relaxed text-zinc-700 dark:text-zinc-300">
        <span className="font-medium text-zinc-900 dark:text-white">Say first:</span> one pass with a set. If a number is already in it, that's the duplicate.
      </p>
      {near ? (
        <CodeBlock code={{ language: "python", content: CODE }} />
      ) : (
        <div aria-hidden="true" className="h-48 rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
      )}
      <p className="text-[0.6875rem] text-zinc-500 dark:text-zinc-400">O(n) time · O(n) space</p>
    </div>
  );
}

/** The Windows app's compact window: the orb, Listening, the clock, its buttons, and the answer under the question. */
export function CompactWindowArt() {
  const p = usePlay<HTMLDivElement>();
  const t = useClock(p.shown, p.play, 3000);
  const typed = typedWords(A, t, 600, 80);
  return (
    <div ref={p.ref} {...p.attrs} role="img" aria-label={`Orbit for Windows in its compact window, on top of the call: Listening, 12:40, the question "${Q}" and a suggested answer.`} className="kp mx-auto w-full max-w-[23.75rem]">
      <div className="overflow-hidden rounded-xl border mk-line mk-surface shadow-popover">
        <div className="flex h-10 items-center gap-2 border-b mk-line pl-3">
          <OrbitLogo size={18} animated={false} />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.6875rem] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/20 dark:text-emerald-200">
            <Circle className="h-1.5 w-1.5 fill-current" aria-hidden="true" /> Listening
          </span>
          <span className="text-[0.75rem] tabular-nums text-zinc-500 dark:text-zinc-400">12:40</span>
          <span className="ml-auto flex h-full items-center text-zinc-500 dark:text-zinc-400">
            {[Maximize2, Ellipsis].map((Icon, i) => (
              <span key={i} className="grid h-full w-8 place-items-center">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            ))}
            <span className="grid h-full w-8 place-items-center text-rose-600 dark:text-rose-400">
              <PhoneOff className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            {[Minus, X].map((Icon, i) => (
              <span key={i} className="hidden h-full w-8 place-items-center min-[400px]:grid">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            ))}
          </span>
        </div>
        <div className="space-y-2 p-3">
          <p className="rounded-lg border mk-line px-2.5 py-1.5 text-[0.75rem] font-medium text-zinc-950 dark:text-white">{Q}</p>
          <div className="rounded-lg bg-indigo-500/[0.045] px-2.5 py-2 ring-1 ring-inset ring-indigo-500/15 dark:bg-indigo-400/[0.06] dark:ring-indigo-300/15">
            <Typed className="text-[0.75rem] leading-relaxed text-zinc-800 dark:text-zinc-100" text={A} shown={typed.shown} typing={typed.typing} />
            <span className="kp-fade mt-2 flex items-center gap-1 text-[0.625rem] text-zinc-500 dark:text-zinc-400" style={at(2700)}>
              <FileText className="h-3 w-3" aria-hidden="true" /> Resume · Lumen Analytics
              <Copy className="ml-auto h-3 w-3" aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[0.6875rem] text-zinc-500 dark:text-zinc-400">Always on top, more or less see-through, out of the way of the call</p>
    </div>
  );
}
