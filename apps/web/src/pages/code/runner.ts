/**
 * Code AI's test runner: the candidate's JavaScript runs in a worker made from their code and a small harness, so
 * it can't touch the page and an endless loop is stopped (the worker is terminated after the time limit). Nothing
 * runs on the server. The comparison is plain data equality, with `unordered` answers compared as sorted lists.
 */

export type TestResult = { args: unknown[]; expected: unknown; got?: unknown; error?: string; ok: boolean };
export type RunResult = { passed: number; total: number; results: TestResult[]; error?: string };

const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v);

export function sameAnswer(got: unknown, expected: unknown, unordered = false): boolean {
  if (unordered && Array.isArray(got) && Array.isArray(expected)) {
    const key = (x: unknown) => JSON.stringify(canon(x));
    return JSON.stringify([...got].map(key).sort()) === JSON.stringify([...expected].map(key).sort());
  }
  return JSON.stringify(got) === JSON.stringify(expected);
}

/** How a call reads in the results: `pairSum([4,9,1,7], 8)`. */
export function callText(fn: string, args: unknown[]): string {
  const text = `${fn}(${args.map((a) => JSON.stringify(a)).join(", ")})`;
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

/** The first failing test, as the review is told about it. */
export function failingText(fn: string, r: RunResult): string {
  const f = r.results.find((t) => !t.ok);
  if (!f) return "";
  return `${callText(fn, f.args)} ${f.error ? `threw ${f.error}` : `gave ${JSON.stringify(f.got)}`}, expected ${JSON.stringify(f.expected)}`.slice(0, 600);
}

/** The worker's whole script: the candidate's code, then the harness that calls their function on each test. */
export function workerSource(code: string, fn: string, tests: Array<{ args: unknown[] }>): string {
  return `${code}
;(() => {
  const tests = ${JSON.stringify(tests.map((t) => t.args))};
  const out = [];
  const f = typeof ${fn} === "function" ? ${fn} : null;
  for (const args of tests) {
    if (!f) { out.push({ error: "No function named ${fn}" }); continue; }
    try { out.push({ got: f(...structuredClone(args)) }); }
    catch (e) { out.push({ error: String(e && e.message || e) }); }
  }
  postMessage(out);
})();`;
}

export function runTests(code: string, fn: string, tests: Array<{ args: unknown[]; expected: unknown }>, unordered = false, timeoutMs = 3000): Promise<RunResult> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(URL.createObjectURL(new Blob([workerSource(code, fn, tests)], { type: "text/javascript" })));
    } catch (e) {
      resolve({ passed: 0, total: tests.length, results: [], error: String(e) });
      return;
    }
    const timer = window.setTimeout(() => {
      worker.terminate();
      resolve({ passed: 0, total: tests.length, results: [], error: `Stopped after ${timeoutMs / 1000} seconds: is there an endless loop?` });
    }, timeoutMs);
    worker.onmessage = (e: MessageEvent<Array<{ got?: unknown; error?: string }>>) => {
      window.clearTimeout(timer);
      worker.terminate();
      const results = tests.map((t, i) => {
        const r = e.data[i] ?? { error: "no result" };
        return { args: t.args, expected: t.expected, got: r.got, error: r.error, ok: !r.error && sameAnswer(r.got, t.expected, unordered) };
      });
      resolve({ passed: results.filter((r) => r.ok).length, total: tests.length, results });
    };
    worker.onerror = (e) => {
      window.clearTimeout(timer);
      worker.terminate();
      e.preventDefault();
      resolve({ passed: 0, total: tests.length, results: [], error: e.message || "Your code didn't run (a syntax error?)" });
    };
  });
}
