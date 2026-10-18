import { useEffect, type ReactNode } from "react";
import { announce, useCopy } from "../hooks/useFeedback";
import { Copy } from "../icons";
import { Button, ButtonTick, MorphLabel, type ButtonSize, type ButtonVariant } from "./ui";

/**
 * Copies text and says so on itself (DESIGN.md "Interaction"): the label morphs to "Copied" with a tick for a moment,
 * at a width that never changes (both are laid out in one place), then comes back. When the clipboard is missing or
 * refused it says "Couldn't copy" instead (`onFailed` can add how to copy by hand). Screen readers hear the result;
 * an Android phone gives a short buzz at Full motion. Disabled while there's nothing to copy.
 */
export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  variant = "secondary",
  size = "sm",
  icon = true,
  className,
  title,
  disabled,
  onCopied,
  onFailed,
}: {
  /** What goes on the clipboard (a function is read at the press, for text built on demand). */
  text: string | (() => string);
  label?: ReactNode;
  copiedLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** The copy icon before the label (the tick replaces it once copied). */
  icon?: boolean;
  className?: string;
  /** A longer explanation, as a tooltip. */
  title?: string;
  disabled?: boolean;
  onCopied?: () => void;
  onFailed?: () => void;
}) {
  const [state, copy] = useCopy();
  useEffect(() => {
    if (state === "copied") announce(copiedLabel);
    else if (state === "failed") announce("Couldn't copy");
  }, [state, copiedLabel]);
  const glyph = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      tip={title}
      disabled={disabled ?? (typeof text === "string" && !text.trim())}
      onClick={() => void copy(typeof text === "function" ? text() : text).then((ok) => (ok ? onCopied?.() : onFailed?.()))}
    >
      <MorphLabel
        show={state === "copied" ? "copied" : "idle"}
        states={{
          // A refusal is rare: its words take the label's place rather than widening every copy button for it.
          idle:
            state === "failed" ? (
              <>Couldn’t copy</>
            ) : (
              <>
                {icon && <Copy className={glyph} aria-hidden />}
                {label}
              </>
            ),
          copied: (
            <>
              <ButtonTick className={glyph} />
              {copiedLabel}
            </>
          ),
        }}
      />
    </Button>
  );
}
