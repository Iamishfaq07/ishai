import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { announce, haptic } from "../hooks/useFeedback";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "../icons";
import { cx, focusRing } from "./cx";
import { Orb, type OrbState } from "./Orb";
import { SPARK, SpotIllustration } from "./Illustrations";
import { Tooltip } from "./Tooltip";

/**
 * The one button system (DESIGN.md, "Buttons"):
 * - `primary`: the page's main action, the solid accent (white on accent-600 is over 5:1 in every accent). One per view.
 * - `secondary`: bordered, for the other actions beside it.
 * - `ghost`: plain, for quiet actions in toolbars, rows and menus.
 * - `danger`: quiet rose text, for a destructive action that asks first (Delete in a header).
 * - `destructive`: solid rose, for the button that does the destructive thing (inside a confirm).
 * - `link`: an inline text action in the accent, no box.
 * Sizes: `sm` 30 px (dense rows and cards), `md` 38 px (the default, the same height as a field), `lg` 46 px. Every
 * variant carries a 1 px border (transparent unless bordered), so mixed buttons line up. No gradients, glows, sheens
 * or shadows: a button says what it does, it doesn't perform.
 * Feel (DESIGN.md "Interaction", base.css .btn): hover is one tint step (where there is a hover), a press one step
 * darker and 97% at Full motion (80 ms in, 140 ms out), keyboard focus an accent outline. Nothing else moves, ever.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "destructive" | "link";
export type ButtonSize = "sm" | "md" | "lg";

// Rest, hover (one step), press (one step more); a disabled button keeps its rest colours (no hover tint).
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "border border-transparent bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 aria-pressed:bg-indigo-800 disabled:bg-indigo-600",
  secondary:
    "border border-zinc-300 bg-white text-zinc-900 hover:border-zinc-400 hover:bg-zinc-50 active:bg-zinc-100 aria-pressed:border-zinc-400 aria-pressed:bg-zinc-100 disabled:border-zinc-300 disabled:bg-white dark:border-white/15 dark:bg-white/[0.04] dark:text-zinc-100 dark:hover:border-white/25 dark:hover:bg-white/[0.08] dark:active:bg-white/[0.12] dark:aria-pressed:border-white/30 dark:aria-pressed:bg-white/[0.12] dark:disabled:border-white/15 dark:disabled:bg-white/[0.04]",
  ghost:
    "border border-transparent text-zinc-700 hover:bg-zinc-900/5 active:bg-zinc-900/10 aria-pressed:bg-zinc-900/[0.08] aria-pressed:text-zinc-900 disabled:bg-transparent dark:text-zinc-300 dark:hover:bg-white/5 dark:active:bg-white/10 dark:aria-pressed:bg-white/10 dark:aria-pressed:text-white dark:disabled:bg-transparent",
  danger:
    "border border-transparent text-rose-700 hover:bg-rose-50 active:bg-rose-100 disabled:bg-transparent dark:text-rose-400 dark:hover:bg-rose-500/10 dark:active:bg-rose-500/20 dark:disabled:bg-transparent",
  destructive: "border border-transparent bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 disabled:bg-rose-600",
  link: "border border-transparent text-indigo-700 underline-offset-4 hover:underline active:text-indigo-900 disabled:no-underline dark:text-indigo-300 dark:active:text-indigo-100",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3.5 py-2 text-sm",
  lg: "px-5 py-2.5 text-base",
};

/** An icon-only button's square, the same height as its size's text button. */
const SQUARE: Record<ButtonSize, string> = {
  sm: "h-[30px] w-[30px]",
  md: "h-[38px] w-[38px]",
  lg: "h-[46px] w-[46px]",
};

/**
 * The Button look as a class string, for things that act like a button but aren't a <button>: router links,
 * `<a href>`, a file input's <label>. One source, so a link-button never drifts from the real thing.
 */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  return cx(
    // .btn (base.css): the colour easing and the press (Full motion only), for a <button> and a link alike.
    "btn inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed",
    variant === "link" ? (size === "sm" ? "text-xs" : size === "lg" ? "text-base" : "text-sm") : SIZE[size],
    // On a touch screen the smaller sizes (and text links) take taps over at least 44 px of height (base.css .tap-y).
    size !== "lg" && "tap-y",
    VARIANT[variant],
    focusRing,
    className,
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Busy: a spinner takes the label's place at the same width (nothing shifts), presses are ignored and screen
   *  readers hear it's busy (aria-busy). Unlike `disabled` it keeps keyboard focus where it was. */
  loading?: boolean;
  /** Words beside the spinner while busy ("Saving…", "Sending…"). The button is always as wide as its widest state,
   *  so the change never moves it. */
  loadingText?: ReactNode;
  /** It worked: for a moment (`useFlash`), a tick draws in beside `doneText` ("Saved"), then the label comes back.
   *  Read out politely; a short buzz on Android phones at Full motion. For actions that save, not for every press. */
  done?: boolean;
  doneText?: ReactNode;
  /** Why it's disabled, when the code knows ("Type DELETE to confirm"): a tooltip on hover and keyboard focus, and
   *  the button's description. It stays focusable (aria-disabled) so a keyboard can reach the reason. */
  disabledReason?: string;
  /** A short tooltip (hover after a moment, keyboard focus at once). IconButton's is its label. */
  tip?: ReactNode;
  /** Full width on a phone, its own width from `sm` up (a form's or a sheet's main action, in thumb reach). */
  block?: boolean;
};

/** A button's spinner: a ring with a gap, in the text's colour (base.css .btn-spinner: it turns at Full, breathes at
 *  Gentle, holds still at Off). */
export function ButtonSpinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("btn-spinner h-4 w-4 shrink-0", className)}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** A tick that draws itself once its state is in (base.css .btn-tick). */
export function ButtonTick({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("h-4 w-4 shrink-0", className)}>
      <path className="btn-tick" pathLength={1} d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Words that take turns in one place (a button's idle, busy and done states): all laid out in one cell, so the widest
 * sets the width and a change never moves anything; the one showing fades in as the last fades out (base.css
 * .btn-stack). Only the one showing is read by screen readers.
 */
export function MorphLabel<K extends string>({ show, states, className }: { show: K; states: Record<K, ReactNode>; className?: string }) {
  return (
    <span className={cx("btn-stack", className)}>
      {(Object.keys(states) as K[]).map((k) => (
        <span key={k} className="btn-layer" data-on={k === show} aria-hidden={k === show ? undefined : true}>
          {states[k]}
        </span>
      ))}
    </span>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  loadingText,
  done,
  doneText = "Saved",
  disabledReason,
  tip,
  block = false,
  className,
  children,
  onClick,
  disabled,
  ...rest
}: ButtonProps) {
  // The spinner and the states sit over the label, so the button needs a position (unless the caller placed it).
  const positioned = /(^|\s)(absolute|fixed|sticky)(\s|$)/.test(className ?? "");
  const explained = Boolean(disabled && disabledReason);
  const inert = loading || explained;
  const stacked = loadingText !== undefined || done !== undefined;
  const state = loading ? "loading" : done ? "done" : "idle";
  const reasonId = useId();
  const wasDone = useRef(done);
  useEffect(() => {
    if (done && !wasDone.current) {
      haptic("confirm");
      if (typeof doneText === "string") announce(doneText);
    }
    wasDone.current = done;
  }, [done, doneText]);
  const small = size === "sm" ? "h-3.5 w-3.5" : undefined;
  const button = (
    <button
      type="button"
      {...rest}
      disabled={explained ? undefined : disabled}
      data-state={stacked || loading ? state : undefined}
      aria-busy={loading || undefined}
      aria-disabled={inert || rest["aria-disabled"] || undefined}
      aria-describedby={explained ? cx(rest["aria-describedby"], reasonId) : rest["aria-describedby"]}
      // preventDefault also stops a busy (or explained-disabled) submit button from sending its form.
      onClick={inert ? (e) => e.preventDefault() : onClick}
      className={buttonClass(
        variant,
        size,
        cx(block && "w-full sm:w-auto", loading && "cursor-progress", explained && "opacity-50", !positioned && "relative", className),
      )}
    >
      {stacked ? (
        <MorphLabel
          show={state}
          states={{
            idle: children,
            loading: (
              <>
                <ButtonSpinner className={small} />
                {loadingText}
              </>
            ),
            done: (
              <>
                <ButtonTick className={small} />
                {doneText}
              </>
            ),
          }}
        />
      ) : (
        <>
          {/* `contents`: the label lays out exactly as if unwrapped; while loading it's hidden but keeps its width. */}
          <span className={cx("contents", loading && "invisible")}>{children}</span>
          {loading && (
            <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
              <ButtonSpinner className={small} />
            </span>
          )}
        </>
      )}
      {explained && (
        <span id={reasonId} hidden>
          {disabledReason}
        </span>
      )}
    </button>
  );
  const shown = explained ? disabledReason : tip;
  return shown ? (
    <Tooltip content={shown} describe={false}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}

/**
 * An icon-only button: a square of its size, named for screen readers by `label`, which is also its tooltip (the
 * styled one: after a moment on hover, at once on keyboard focus; `title` replaces the words). The icon is
 * decorative. Its target is at least 40 px square with a mouse however small it's drawn (.hit-area), and 44 px tall on a
 * touch screen (.tap-y). Default `ghost`
 * (toolbars, rows, a dialog's close).
 */
export function IconButton({
  label,
  icon: Icon,
  variant = "ghost",
  size = "md",
  className,
  title,
  ...rest
}: Omit<ButtonProps, "children" | "block"> & { label: string; icon: ComponentType<{ className?: string }> }) {
  return (
    <Button {...rest} tip={rest.tip ?? title ?? label} variant={variant} size={size} aria-label={label} className={cx(SQUARE[size], "hit-area !p-0", className)}>
      <Icon className={size === "sm" ? "h-4 w-4" : size === "lg" ? "h-5 w-5" : "h-[18px] w-[18px]"} aria-hidden />
    </Button>
  );
}

/**
 * The tick on a selectable card that's chosen (a template, a preset): it pops in on the chosen card and shrinks away
 * from the one that isn't (base.css .select-check). Decorative: the card's aria-pressed / aria-checked says it. Place
 * it in a `relative` card; it sits at the top-right corner unless `className` moves it.
 */
export function SelectCheck({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-on={on}
      className={cx("select-check absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm", className)}
    >
      <svg viewBox="0 0 16 16" className="h-3 w-3" focusable="false">
        <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** Buttons that belong together, joined into one bar (a view switch, Back/Next). `label` names the group. */
export function ButtonGroup({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        "inline-flex items-stretch [&>*:first-child]:rounded-l-xl [&>*:last-child]:rounded-r-xl [&>*:not(:first-child)]:-ml-px [&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none [&>*:focus-visible]:z-10",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A surface: frosted glass on the public pages, opaque with a hairline border in the app (base.css). `interactive`
 *  (a card that is a link or a button) darkens its border on hover; it doesn't move. */
export function Card({ children, className, interactive, id }: { children: ReactNode; className?: string; interactive?: boolean; id?: string }) {
  return (
    <div
      id={id}
      className={cx(
        "glass-panel rounded-2xl p-5",
        interactive && "transition-colors duration-quick hover:!border-zinc-300 dark:hover:!border-white/20",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A page's head: its title, one line under it, and the page's actions at the end of the row (they wrap under the
 * title on a phone). `back` (a link to the list a detail page came from) sits above the title. The icon tile is
 * neutral and shows from `sm` up: on a phone the title gets the width.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  icon: Icon,
  back,
  art,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  back?: ReactNode;
  /** A small Orbit scene at the row's end, from `lg` up: a product's main page (decorative). It overhangs the row a
   *  little rather than making the header taller. */
  art?: ReactNode;
}) {
  const head = (
    <div className={cx("flex flex-wrap items-center justify-between gap-x-6 gap-y-3", !back && "mb-6")}>
      <div className="flex min-w-0 flex-1 basis-[20rem] items-center gap-3">
        {Icon && <IconTile icon={Icon} className="hidden sm:flex" />}
        <div className="min-w-0">
          <h1 className="break-words font-display text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
        </div>
      </div>
      {art && <div aria-hidden="true" className="scene-host -my-5 hidden w-36 shrink-0 lg:block">{art}</div>}
      {actions}
    </div>
  );
  if (!back) return head;
  return (
    <div className="mb-6">
      <div className="mb-3">{back}</div>
      {head}
    </div>
  );
}

/** A neutral icon tile, for a page's, a section's or a card's heading. Decorative: the words beside it say it. */
export function IconTile({ icon: Icon, size = "md", className }: { icon: ComponentType<{ className?: string }>; size?: "sm" | "md"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex shrink-0 items-center justify-center bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10",
        size === "sm" ? "h-8 w-8 rounded-lg" : "h-10 w-10 rounded-xl",
        className,
      )}
    >
      <Icon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
    </span>
  );
}

/**
 * A form field: its label, the control, then one line under it: the error when there is one (what to do, said
 * plainly: "Add a company name"), else the hint. `required` marks the label (and tells screen readers); `counter`
 * shows how much of a limit is used, turning amber in the last tenth. With `htmlFor`, the control is wired to its
 * hint and error (aria-describedby) and marked invalid while there's an error. Show an error after the person leaves
 * the field or submits, not while they type.
 */
export function Field({
  label,
  hint,
  children,
  htmlFor,
  required,
  error,
  counter,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
  required?: boolean;
  error?: string | null;
  counter?: { value: number; max: number };
}) {
  const noteId = htmlFor ? `${htmlFor}-note` : undefined;
  const note = error || hint;
  const control =
    htmlFor && note && isValidElement<Record<string, unknown>>(children)
      ? cloneElement(children, {
          "aria-describedby": cx(children.props["aria-describedby"] as string | undefined, noteId) || undefined,
          ...(error ? { "aria-invalid": true } : {}),
        })
      : children;
  return (
    // min-w-0: a select sizes to its longest option; without this it stretches a grid column past a phone's width.
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {label}
          {required && (
            <>
              <span aria-hidden="true" className="ml-0.5 text-rose-700 dark:text-rose-400">*</span>
              <span className="sr-only"> (required)</span>
            </>
          )}
        </label>
        {counter && (
          <span
            className={cx(
              "text-xs tabular-nums",
              counter.value > counter.max * 0.9 ? "text-amber-700 dark:text-amber-300" : "text-zinc-500 dark:text-zinc-400",
            )}
          >
            {counter.value.toLocaleString()} / {counter.max.toLocaleString()}
          </span>
        )}
      </div>
      {control}
      {error ? (
        <p id={noteId} className="flex items-start gap-1.5 text-xs font-medium text-rose-700 dark:text-rose-300">
          <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : (
        hint && <p id={noteId} className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      )}
    </div>
  );
}

const control =
  "block w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 transition-colors hover:border-zinc-300 focus:border-indigo-500 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:hover:border-white/20 dark:focus:border-indigo-400";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(control, focusRing, props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(control, focusRing, props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(control, focusRing, props.className)} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("group/switch flex w-full items-start justify-between gap-4 rounded-lg text-left disabled:opacity-50", focusRing)}
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{description}</span>}
      </span>
      {/* The track fills as the thumb glides across (base.css .switch-thumb); hover and a press deepen the track a step. */}
      <span
        aria-hidden="true"
        className={cx(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-quick ease-standard",
          checked
            ? "bg-indigo-600 group-hover/switch:bg-indigo-700 group-active/switch:bg-indigo-800"
            : "bg-zinc-300 group-hover/switch:bg-zinc-400 group-active/switch:bg-zinc-400 dark:bg-zinc-700 dark:group-hover/switch:bg-zinc-600 dark:group-active/switch:bg-zinc-600",
        )}
      >
        <span className={cx("switch-thumb absolute left-0 top-1 h-4 w-4 rounded-full bg-white shadow", checked ? "translate-x-6" : "translate-x-1")} />
      </span>
    </button>
  );
}

/** Loading: a dotted orb whose animation says what is going on (`state`), with the words beside it. `big` stacks a
 *  larger orb over the words, for a page or panel that is loading. */
export function Spinner({ label = "Loading", state = "working", big = false }: { label?: string; state?: OrbState; big?: boolean }) {
  return (
    <span
      role="status"
      className={cx(
        "inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400",
        big && "flex w-full flex-col justify-center gap-3 py-12 text-center",
      )}
    >
      <Orb state={state} size={big ? 64 : 20} />
      {label.replace(/[.…]+$/, "")}…
    </span>
  );
}

/** An error the person must act on, inline where it happened: the error Callout, with Retry when there's one. */
export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <Callout
      tone="error"
      action={
        onRetry && (
          // Padded to a 24 px target (WCAG 2.5.8) without moving the text.
          <button type="button" onClick={onRetry} className={cx("-my-1 rounded px-1 py-1 font-medium underline", focusRing)}>
            Retry
          </button>
        )
      }
    >
      {children}
    </Callout>
  );
}

export type CalloutTone = "info" | "success" | "warning" | "error";

const CALLOUT: Record<CalloutTone, { box: string; icon: ComponentType<{ className?: string }>; mark: string }> = {
  info: {
    box: "border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-200",
    icon: Info,
    mark: "text-zinc-500 dark:text-zinc-400",
  },
  success: {
    box: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100",
    icon: CircleCheck,
    mark: "text-emerald-700 dark:text-emerald-300",
  },
  warning: {
    box: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100",
    icon: TriangleAlert,
    mark: "text-amber-700 dark:text-amber-300",
  },
  error: {
    box: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200",
    icon: CircleAlert,
    mark: "text-rose-700 dark:text-rose-300",
  },
};

/**
 * An inline banner in the page's flow: `info` (ink, a note), `success`, `warning` (amber: something to check), `error`
 * (rose: something failed; announced). A bold `title` is optional; `action` sits at the end (a button or link);
 * `onDismiss` adds a close. Not for transient confirmations (toast) or questions (confirmDialog).
 */
export function Callout({
  tone = "info",
  title,
  children,
  action,
  onDismiss,
  icon,
  className,
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  /** Replaces the tone's icon; `false` for none. */
  icon?: ReactNode | false;
  className?: string;
}) {
  const t = CALLOUT[tone];
  const Icon = t.icon;
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cx("flex items-start gap-3 rounded-xl border px-3.5 py-2.5 text-sm", t.box, className)}
    >
      {icon !== false && (
        <span aria-hidden="true" className={cx("mt-0.5 flex shrink-0", t.mark)}>
          {icon ?? <Icon className="h-4 w-4" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5" : undefined}>{children}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2 self-center">{action}</div>}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={cx("-my-1 -mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10", focusRing)}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const BADGE: Record<BadgeTone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10",
  accent: "bg-indigo-500/10 text-indigo-700 ring-indigo-500/20 dark:text-indigo-200 dark:ring-indigo-400/25",
  success: "bg-emerald-500/10 text-emerald-800 ring-emerald-600/20 dark:text-emerald-200 dark:ring-emerald-400/25",
  warning: "bg-amber-500/10 text-amber-900 ring-amber-500/25 dark:text-amber-200 dark:ring-amber-400/25",
  danger: "bg-rose-500/10 text-rose-800 ring-rose-500/20 dark:text-rose-200 dark:ring-rose-400/25",
  info: "bg-sky-500/10 text-sky-800 ring-sky-500/20 dark:text-sky-200 dark:ring-sky-400/25",
};

/**
 * A small label for a state: `success` (done, ready, live), `warning` (waiting, needs a look), `danger` (failed,
 * suspended), `info`, `accent` (new, selected), `neutral` (a count, a kind). Colour means status only, so a badge
 * always says its state in words; `dot` adds a leading dot in the same colour.
 */
export function Badge({ tone = "neutral", dot = false, children, className }: { tone?: BadgeTone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", BADGE[tone], className)}>
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** A keyboard key, for shortcut hints ("Ctrl K", "/"). */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        "inline-flex min-w-[1.25rem] items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-px font-sans text-[11px] font-medium leading-4 text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * What a screen says when it has nothing to show: a headline, one line and one imperative action, in four kinds.
 * - `first-use` (default): nothing yet. `preview` (a GhostPreview) shows, faded, what will fill the screen.
 * - `no-results`: a search or filter matched nothing. Say what was searched; offer to clear or widen it.
 * - `cleared`: everything done ("No follow-ups due. Nice."). A small, still celebration unless `art` says otherwise.
 * - `offline`: couldn't load. Say what happened; `onRetry` adds Try again. Announced like an error.
 * Never show one while loading: that's a Skeleton. (Kept in this module: it's on most pages.)
 */
export type EmptyKind = "first-use" | "no-results" | "cleared" | "offline";

export interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  /** The one thing to do next: a Button, or a link styled with buttonClass(). */
  action?: ReactNode;
  kind?: EmptyKind;
  /** A lucide icon, shown in Orbit's spot illustration. */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Larger art (one of the Orbit scenes); replaces `icon`. Decorative. */
  art?: ReactNode;
  /** First use: a faded picture of the filled screen above the words. Decorative and inert. */
  preview?: ReactNode;
  /** Offline: what Try again does. */
  onRetry?: () => void;
  className?: string;
}

export function EmptyState({ title, body, action, kind = "first-use", icon, art, preview, onRetry, className }: EmptyStateProps) {
  const picture = art ?? (icon ? <SpotIllustration icon={icon} size={96} /> : kind === "cleared" && <ClearedMark />);
  const ghost = preview != null && preview !== false;
  return (
    <div
      role={kind === "offline" ? "alert" : undefined}
      className={cx(
        "relative flex flex-col items-center overflow-hidden rounded-2xl px-6 text-center",
        kind === "no-results" ? "py-8" : "border border-dashed py-10",
        kind === "cleared" ? "border-emerald-500/30 dark:border-emerald-400/20" : "border-zinc-300 dark:border-white/10",
        ghost && "pt-6",
        className,
      )}
    >
      {ghost && (
        <div
          aria-hidden="true"
          inert
          className="pointer-events-none mb-2 w-full max-w-2xl select-none opacity-80 [mask-image:linear-gradient(to_bottom,black_35%,transparent_95%)]"
        >
          {preview}
        </div>
      )}
      {picture && <div className={cx("mb-4", ghost && "-mt-12")}>{picture}</div>}
      <p className={cx("text-balance font-display text-lg font-medium", ghost && !picture && "-mt-6")}>{title}</p>
      {body && <div className="mx-auto mt-1 max-w-md text-pretty text-sm text-zinc-500 dark:text-zinc-400">{body}</div>}
      {(action || onRetry) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}

/** "All done": a ticked ring with two of Orbit's sparks, still. */
function ClearedMark() {
  return (
    <svg viewBox="0 0 96 96" className="h-20 w-20 overflow-visible" aria-hidden="true" focusable="false">
      <circle cx="48" cy="48" r="40" className="fill-none stroke-emerald-500/25" strokeDasharray="2 6" />
      <circle cx="48" cy="48" r="26" className="fill-emerald-500/10 stroke-emerald-500 dark:stroke-emerald-400" strokeWidth="2" />
      <path d="M37 49 l7.5 7.5 L60 41" className="fill-none stroke-emerald-600 dark:stroke-emerald-300" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d={SPARK(84, 20, 6)} className="fill-aurora-400" />
      <path d={SPARK(12, 70, 4)} className="fill-indigo-400" />
    </svg>
  );
}

export function Meter({ level, label }: { level: number; label: string }) {
  return (
    <div
      className="flex items-center gap-2"
      role="meter"
      aria-label={`${label} level`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
    >
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width] duration-75 motion-reduce:transition-none"
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
    </div>
  );
}
