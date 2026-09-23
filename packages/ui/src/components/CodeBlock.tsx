import { useState } from "react";
import type { LiveAnswerCode } from "@orbit/types";
import { cx, focusRing } from "./cx";

export function CodeBlock({ code }: { code: LiveAnswerCode }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">{code.language || "code"}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className={cx("rounded px-1.5 text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100", focusRing)}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto p-3 text-[12.5px] leading-relaxed">
        <code className="font-mono text-zinc-800 dark:text-zinc-200">{code.content}</code>
      </pre>
    </div>
  );
}
