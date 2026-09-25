/**
 * Adaptive "NEXT" guidance: which of the answer's key points the candidate has already said, and what to say next.
 *
 * Runs locally on every transcript update (no model call). A point counts as covered when the candidate's own words
 * since the answer appeared contain most of the point's label words, or a good share of the answer sentence the
 * point summarises (candidates often paraphrase the suggested answer). Words are compared by a crude 5-letter stem
 * ("scanning" ≈ "scanner", "blocking" ≈ "block"), after dropping filler/stop words.
 */

const STOP = new Set(
  ("a an the and or but so to of in on at for with by from into about as is are was were be been being it its this " +
    "that these those there here i me my we our you your they them their he she his her who which what how why when " +
    "where do does did have has had can could would will should may might must just really very also then than " +
    "like um uh yeah okay ok right well kind sort bit lot lots thing things way ways get got make made go going " +
    "one ones some any all more most much many first then next also not no yes if because while each every")
    .split(" "),
);

/** Abbreviations labels use for things people say in full ("PR" — "pull request"), as stems. */
const ALIASES: Record<string, string[]> = {
  pr: ["pull", "reque"], prs: ["pull", "reque"], ci: ["conti", "integ"], cd: ["conti", "deliv", "deplo"],
  db: ["datab"], k8s: ["kuber"], api: ["inter"], auth: ["authe", "authz"], authn: ["authe"], authz: ["autho"],
  sla: ["servi", "level"], slo: ["servi", "level", "objec"], ml: ["machi", "learn"], qa: ["quali", "testi"],
};

export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z0-9+#]+/g) ?? []) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.add(raw.length > 5 ? raw.slice(0, 5) : raw);
  }
  return out;
}

/** A label's words plus the full forms of its abbreviations: a hit on either counts. */
function labelWords(label: string): Set<string> {
  const words = contentWords(label);
  for (const w of [...words]) for (const alias of ALIASES[w] ?? []) words.add(alias);
  return words;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n += 1;
  return n;
}

/**
 * Points for a finished answer that came without a POINTS line (e.g. it used its whole length budget): the opening
 * words of each paragraph, which is where spoken answers put each point. Needs at least two paragraphs.
 */
export function fallbackPoints(answerText: string, maxPoints = 5, maxWords = 7): string[] {
  const paras = answerText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length < 2) return [];
  return paras.slice(0, maxPoints).map((p) => {
    const first = sentences(p)[0] ?? p;
    const words = first.replace(/^(so|and|then|also|first|next|finally)[, ]+/i, "").split(/\s+/);
    const label = words.slice(0, maxWords).join(" ").replace(/[,;:—–-]+$/, "");
    return words.length > maxWords ? `${label}…` : label.replace(/[.!?]$/, "");
  });
}

export interface PointProgress {
  label: string;
  covered: boolean;
  /** Set by the candidate's click rather than detected from speech. */
  manual?: boolean;
}

export interface KeyPointProgress {
  points: PointProgress[];
  /** Index of the point to say next; null when everything is covered. */
  next: number | null;
}

/** Pure scoring: which points `spoken` covers. `alreadyCovered` keeps earlier ticks (never un-ticks). */
export function scoreKeyPoints(
  labels: string[],
  answerText: string,
  spoken: string,
  alreadyCovered: ReadonlySet<number> = new Set(),
): KeyPointProgress {
  const said = contentWords(spoken);
  const answerSentences = sentences(answerText).map(contentWords);
  let cursor = 0; // align points to answer sentences in order
  const points = labels.map((label, i) => {
    const plain = contentWords(label); // what "most of the label" is measured against
    const words = labelWords(label); // + abbreviation expansions, which also count as hits
    let support = new Set<string>();
    let best = 0;
    const from = cursor;
    for (let j = from; j < answerSentences.length; j++) {
      const score = overlap(words, answerSentences[j]!);
      if (score > best) {
        best = score;
        support = answerSentences[j]!;
        cursor = j;
      }
    }
    let labelHits = overlap(plain, said);
    for (const w of plain) if (!said.has(w) && (ALIASES[w] ?? []).some((a) => said.has(a))) labelHits += 1;
    const needed = Math.max(1, Math.ceil(plain.size * 0.6));
    const byLabel = plain.size > 0 && labelHits >= needed;
    // Sharing generic topic words with a long sentence ("build", "scan") isn't enough on its own: a looser match
    // must also include one of the point's own words.
    const sentenceHits = overlap(support, said);
    const bySentence =
      support.size >= 4 &&
      (sentenceHits >= support.size * 0.45 || (labelHits >= 1 && sentenceHits >= Math.max(3, support.size * 0.3)));
    return { label, covered: alreadyCovered.has(i) || byLabel || bySentence };
  });
  return { points, next: nextPoint(points) };
}

/** The point to say next: the first uncovered one after the last covered one (else the first uncovered). */
function nextPoint(points: PointProgress[]): number | null {
  const lastCovered = points.reduce((last, p, i) => (p.covered ? i : last), -1);
  let next = points.findIndex((p, i) => !p.covered && i > lastCovered);
  if (next === -1) next = points.findIndex((p) => !p.covered);
  return next === -1 ? null : next;
}

/**
 * The candidate's own clicks win over the automatic ticks: `true` ticks a point they said (the transcript missed
 * it), `false` unticks one they didn't say (a false match). NEXT then moves accordingly.
 */
export function applyOverrides(progress: KeyPointProgress, overrides: ReadonlyMap<number, boolean>): KeyPointProgress {
  if (overrides.size === 0) return progress;
  const points = progress.points.map((p, i) => {
    const manual = overrides.get(i);
    return manual === undefined ? p : { ...p, covered: manual, manual: true };
  });
  return { points, next: nextPoint(points) };
}
