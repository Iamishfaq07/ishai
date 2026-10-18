import { useState, type ReactNode } from "react";
import {
  Button,
  Card,
  Checkbox,
  CopyButton,
  CountUp,
  IconButton,
  LoadGate,
  ProgressBar,
  RadioGroup,
  SegmentedControl,
  SelectCheck,
  Stepper,
  Toggle,
  cx,
  focusRing,
  toast,
  useFlash,
  useFlip,
  PenLine,
  Plus,
  ArrowUpDown,
  ChevronDown,
  Trash2,
} from "@orbit/ui";

/**
 * The gallery's "Interaction" section (DESIGN.md "Interaction", D74): every micro-interaction in one place, so its
 * timing can be judged at Full, Gentle and Off (Settings → Appearance → Animations).
 */
export function InteractionGallery() {
  return (
    <section aria-labelledby="g-interaction" className="space-y-4">
      <h2 id="g-interaction" className="font-display text-lg font-semibold">
        Interaction
      </h2>
      <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
        Press: 80 ms in, 140 ms out, one fill step darker and 97% (Full only). Hover: one tint step, mouse only. Focus:
        an accent outline, keyboard only. Selection: 160 to 240 ms. Open 240 ms, close 160 ms. Gentle keeps the fades,
        Off makes every change instant.
      </p>
      <ButtonStates />
      <Selection />
      <Progression />
      <Lists />
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function ButtonStates() {
  const [saving, setSaving] = useState(false);
  const [saved, flashSaved] = useFlash();
  const [sending, setSending] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const save = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      flashSaved();
    }, 700);
  };
  return (
    <Card className="space-y-4">
      <Row label="Press each">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
      </Row>
      <Row label="Busy, then saved">
        <Button loading={saving} loadingText="Saving…" done={saved} onClick={save}>
          Save profile
        </Button>
        <Button
          variant="secondary"
          loading={sending}
          loadingText="Sending…"
          onClick={() => {
            setSending(true);
            setTimeout(() => setSending(false), 1200);
          }}
        >
          Send the message
        </Button>
        <CopyButton text="https://orbitanswer.com/r/demo" label="Copy link" />
      </Row>
      <Row label="Disabled, and why">
        <Checkbox label="I agree to the terms" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <Button disabled={!agreed} disabledReason="Agree to the terms first" onClick={() => toast("Account made")}>
          Make my account
        </Button>
      </Row>
      <Row label="Icon targets">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">30 px drawn, 40 px to press (44 on touch):</span>
        <IconButton icon={PenLine} label="Edit" size="sm" />
        <IconButton icon={Trash2} label="Delete" size="sm" />
        <IconButton icon={Plus} label="Add" size="sm" variant="secondary" />
      </Row>
    </Card>
  );
}

const TEMPLATES = [
  { id: "classic", label: "Classic", note: "One column, serif headings" },
  { id: "modern", label: "Modern", note: "A side rail for skills" },
  { id: "compact", label: "Compact", note: "Fits two pages on one" },
];

function Selection() {
  const [template, setTemplate] = useState("modern");
  const [range, setRange] = useState<"7" | "30" | "90">("30");
  const [on, setOn] = useState(false);
  const [pace, setPace] = useState<"calm" | "brisk">("calm");
  return (
    <Card className="space-y-4">
      <Row label="Selectable cards">
        <div className="grid w-full max-w-xl grid-cols-3 gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={template === t.id}
              onClick={() => setTemplate(t.id)}
              className={cx(
                "relative rounded-xl border p-3 text-left transition-colors",
                template === t.id ? "border-indigo-500 bg-indigo-500/5 ring-1 ring-indigo-500" : "border-zinc-200 hover:border-zinc-300 dark:border-white/10 dark:hover:border-white/20",
                focusRing,
              )}
            >
              <SelectCheck on={template === t.id} />
              <span className="block text-sm font-medium">{t.label}</span>
              <span className="block pr-5 text-xs text-zinc-500 dark:text-zinc-400">{t.note}</span>
            </button>
          ))}
        </div>
      </Row>
      <Row label="Segmented">
        <SegmentedControl
          label="Range"
          value={range}
          onChange={setRange}
          options={[
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
          ]}
        />
      </Row>
      <Row label="Switch, box, radio">
        <div className="w-64">
          <Toggle checked={on} onChange={setOn} label="Weekly digest" description="Mondays, 9 am" />
        </div>
        <Checkbox label="Remote only" defaultChecked />
        <RadioGroup
          legend="Pace"
          name="g-pace"
          value={pace}
          onChange={setPace}
          options={[
            { value: "calm", label: "Calm" },
            { value: "brisk", label: "Brisk" },
          ]}
          className="flex items-center gap-4 space-y-0 [&>legend]:sr-only"
        />
      </Row>
      <Row label="Disclosure">
        <details className="group w-full max-w-xl rounded-xl ring-1 ring-zinc-200 open:bg-zinc-500/[0.04] dark:ring-white/10">
          <summary className={cx("flex min-h-11 list-none items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden", focusRing)}>
            <span className="flex-1">What counts as a credit?</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-quick group-open:rotate-180" aria-hidden />
          </summary>
          <div className="space-y-2 px-4 pb-4 text-sm text-zinc-600 dark:text-zinc-300">
            <p>One interview credit is one hour of live or mock interviews, used a minute at a time.</p>
            <p>Resume AI credits come with every pack. Credits never expire.</p>
          </div>
        </details>
      </Row>
    </Card>
  );
}

const STEPS = ["Discover", "Prove", "Prepare", "Apply", "Interview"];

function Progression() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(128);
  const reload = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 900);
  };
  return (
    <Card className="space-y-5">
      <Row label="Steps">
        <Stepper steps={STEPS} current={step} label="Demo steps" />
        <Button size="sm" variant="secondary" onClick={() => setStep((s) => (s + 1) % (STEPS.length + 1))}>
          Next step
        </Button>
      </Row>
      <Row label="Progress">
        <ProgressBar className="w-64" label="Resume AI credits" value={step} max={STEPS.length} valueText={`${step} of ${STEPS.length}`} />
      </Row>
      <Row label="Count-up">
        <span className="stat-value font-display text-2xl font-semibold">
          <CountUp to={count} />
        </span>
        <Button size="sm" variant="secondary" onClick={() => setCount((c) => c + 37)}>
          Add 37
        </Button>
      </Row>
      <Row label="Skeleton, then content">
        <Button size="sm" variant="secondary" onClick={reload}>
          Load again
        </Button>
        <div className="w-full max-w-md">
          <LoadGate loading={loading} variant="line" count={2} label="Loading the demo">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">Loaded: the words fade in where the placeholder stood.</p>
          </LoadGate>
        </div>
      </Row>
    </Card>
  );
}

const STORIES = ["Cut churn 9% with a billing model", "Shipped the pricing page in a week", "Calmed a hard stakeholder", "Mentored two analysts"];

function Lists() {
  const [items, setItems] = useState(STORIES.map((title, i) => ({ id: `s${i}`, title })));
  const [next, setNext] = useState(STORIES.length);
  const list = useFlip<HTMLUListElement>(items.map((i) => i.id).join());
  return (
    <Card className="space-y-3">
      <Row label="List changes">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setItems((xs) => [{ id: `s${next}`, title: `A new story (${next + 1})` }, ...xs]);
            setNext((n) => n + 1);
          }}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setItems((xs) => [...xs].sort(() => Math.random() - 0.5))}>
          <ArrowUpDown className="h-3.5 w-3.5" aria-hidden /> Shuffle
        </Button>
      </Row>
      <ul ref={list} aria-label="Demo stories" className="max-w-xl space-y-2">
        {items.map((s) => (
          <li key={s.id} data-flip={s.id} className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-zinc-950">
            <span className="flex-1">{s.title}</span>
            <IconButton icon={Trash2} label={`Remove ${s.title}`} size="sm" onClick={() => setItems((xs) => xs.filter((x) => x.id !== s.id))} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
