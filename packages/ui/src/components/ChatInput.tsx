import { forwardRef, useState, type KeyboardEvent } from "react";
import { cx, focusRing } from "./cx";

export interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const SUGGESTIONS = ["Make it shorter", "Give an example", "Rewrite in STAR format", "What should I say next?"];

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(function ChatInput(
  { onSend, disabled = false, placeholder = "Ask anything…" },
  ref,
) {
  const [text, setText] = useState("");

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Plain Enter sends; Shift+Enter inserts a newline. Mod+Enter is left for the global Answer hotkey.
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      submit(text);
    }
  };

  return (
    <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div className="mb-1.5 flex flex-wrap gap-1">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => submit(s)}
            className={cx(
              "rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800",
              focusRing,
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor="orbit-chat-input">
        Ask Orbit
      </label>
      <textarea
        id="orbit-chat-input"
        ref={ref}
        rows={1}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={cx(
          "block w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100",
          focusRing,
        )}
      />
    </div>
  );
});
