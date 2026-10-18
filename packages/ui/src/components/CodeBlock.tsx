import { useMemo, useState } from "react";
import type { CodingLanguage, LiveAnswerCode } from "@orbit/types";
import { CODING_LANGUAGES } from "../live/preferences";
import { cx, focusRing } from "./cx";
import { normalizeLanguage, tokenize, type TokenKind } from "./highlight";
import { MorphLabel } from "./ui";
import { safeLocal } from "../storage";

const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: "",
  keyword: "text-violet-700 dark:text-violet-300",
  type: "text-sky-700 dark:text-sky-300",
  string: "text-emerald-700 dark:text-emerald-300",
  number: "text-amber-700 dark:text-amber-300",
  comment: "italic text-zinc-500 dark:text-zinc-400",
};

const WRAP_KEY = "orbit.codeWrap";

/**
 * Code with line numbers, highlighting, copy and a wrap toggle. With `onLanguage`, a picker regenerates the answer
 * in another language.
 */
export function CodeBlock({ code, onLanguage }: { code: LiveAnswerCode; onLanguage?: (lang: CodingLanguage) => void }) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(() => safeLocal.getItem(WRAP_KEY) === "on");
  const lines = useMemo(() => {
    // tokenize once, then split tokens across lines so multi-line comments/strings keep their colour
    const out: Array<Array<{ text: string; kind: TokenKind }>> = [[]];
    for (const token of tokenize(code.content, code.language)) {
      const parts = token.text.split("\n");
      parts.forEach((part, i) => {
        if (i > 0) out.push([]);
        if (part) out[out.length - 1]!.push({ text: part, kind: token.kind });
      });
    }
    return out;
  }, [code.content, code.language]);
  const lang = normalizeLanguage(code.language);
  const known = CODING_LANGUAGES.find((l) => l.value === lang);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const toggleWrap = () => {
    safeLocal.setItem(WRAP_KEY, wrap ? "off" : "on");
    setWrap(!wrap);
  };
  const btn = cx("rounded px-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100", focusRing);

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-1 border-b border-zinc-200 px-2 py-1 dark:border-zinc-800">
        {onLanguage ? (
          <select
            value={known?.value ?? ""}
            onChange={(e) => onLanguage(e.target.value as CodingLanguage)}
            aria-label="Code language"
            title="Rewrite the answer in another language"
            className={cx("rounded bg-transparent px-1 py-0.5 font-mono text-xs text-zinc-600 dark:text-zinc-300", focusRing)}
          >
            {!known && <option value="">{code.language || "code"}</option>}
            {CODING_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="px-1 font-mono text-xs uppercase tracking-wider text-zinc-500">{known?.label ?? (code.language || "code")}</span>
        )}
        <span className="flex-1" />
        <button type="button" onClick={toggleWrap} aria-pressed={wrap} className={btn} title="Wrap long lines">
          {wrap ? "No wrap" : "Wrap"}
        </button>
        <button type="button" onClick={() => void copy()} className={btn}>
          <MorphLabel show={copied ? "copied" : "idle"} states={{ idle: "Copy", copied: "Copied" }} />
        </button>
      </div>
      <pre className="max-h-96 overflow-auto py-2 text-[0.8125rem] leading-relaxed">
        <code className="grid font-mono text-zinc-800 dark:text-zinc-200" style={{ gridTemplateColumns: "auto 1fr" }}>
          {lines.map((line, n) => (
            <span key={n} className="contents">
              <span aria-hidden="true" className="select-none pl-3 pr-3 text-right text-zinc-400 dark:text-zinc-600">
                {n + 1}
              </span>
              <span className={cx("pr-3", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")}>
                {line.length ? line.map((t, i) => <span key={i} className={TOKEN_CLASS[t.kind]}>{t.text}</span>) : " "}
              </span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
