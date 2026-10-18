// Making a result the server refused for its size (413) or a field (422) smaller, one step at a time. Pure.
import { MAX_PAYLOAD_CHARS, type ApplyResult } from "./contract";

/** A result made smaller one step at a time, for a 413 or 422: the screenshot goes first, then long values are cut
 * to the server's limits, then the payload of what was entered. Null when there's nothing left to drop. */
export function slimmer(result: ApplyResult, status: number, step: number): ApplyResult | null {
  if (status !== 413 && status !== 422) return null;
  if (result.screenshot_png_b64) return { ...result, screenshot_png_b64: null };
  if (step <= 2) {
    const cut = (v: string, n: number) => v.slice(0, n);
    return {
      ...result,
      unknown_questions: result.unknown_questions.slice(0, 50).map((q) => ({ label: cut(q.label, 2000), kind: q.kind, ...(q.options ? { options: q.options.slice(0, 200).map((o) => cut(o, 300)) } : {}) })),
      confirmation_text: result.confirmation_text ? cut(result.confirmation_text, 8000) : null,
      final_url: result.final_url ? cut(result.final_url, 2000) : null,
      submitted:
        result.submitted && JSON.stringify(result.submitted).length > MAX_PAYLOAD_CHARS / 2
          ? { fields: result.submitted.fields, answers: result.submitted.answers.slice(0, 300).map((a) => ({ ...a, value: Array.isArray(a.value) ? a.value.map((v) => cut(v, 300)) : cut(a.value, 2000) })) }
          : result.submitted,
    };
  }
  if (result.submitted) return { ...result, submitted: null };
  return null;
}
