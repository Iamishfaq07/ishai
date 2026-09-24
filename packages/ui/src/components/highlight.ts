/**
 * Tiny syntax highlighter for interview-sized code: comments, strings, numbers and keywords for the nine offered
 * languages. No dependency, no HTML strings (tokens render as React nodes, so code can never inject markup).
 */

export type TokenKind = "plain" | "keyword" | "string" | "comment" | "number" | "type";
export interface Token {
  text: string;
  kind: TokenKind;
}

const C_LIKE = "if else for while do switch case break continue return new delete try catch finally throw class " +
  "struct enum public private protected static final const void null true false this super import package using " +
  "namespace interface extends implements virtual override abstract default goto sizeof typedef template typename " +
  "auto inline";
const KEYWORDS: Record<string, string> = {
  python: "def return if elif else for while in not and or is None True False class import from as with try except " +
    "finally raise lambda yield pass break continue global nonlocal assert del async await self",
  java: `${C_LIKE} int long double float boolean char byte short String var instanceof synchronized throws`,
  javascript: `${C_LIKE} function let var const of in typeof instanceof undefined async await yield export from`,
  typescript: `${C_LIKE} function let var const of in typeof instanceof undefined async await yield export from type ` +
    "number string boolean any unknown never readonly keyof as",
  cpp: `${C_LIKE} int long double float bool char unsigned signed std vector map unordered_map set string nullptr ` +
    "constexpr size_t",
  csharp: `${C_LIKE} int long double float bool char string var foreach in out ref readonly async await get set ` +
    "List Dictionary",
  go: "func return if else for range switch case break continue go defer chan select struct interface map type var " +
    "const package import nil true false make len append int string bool byte error",
  rust: "fn let mut return if else for while loop in match struct enum impl trait pub use mod self Self None Some Ok " +
    "Err true false as ref move where unsafe i32 i64 u32 u64 usize f64 bool String Vec Option Result HashMap",
  sql: "select from where join inner left right outer on group by order having limit offset insert into values " +
    "update set delete create table index as and or not null is in exists distinct count sum avg min max case " +
    "when then else end with over partition union all",
};

const ALIASES: Record<string, string> = { py: "python", js: "javascript", ts: "typescript", "c++": "cpp", c: "cpp",
  cs: "csharp", "c#": "csharp", golang: "go", rs: "rust", postgres: "sql", mysql: "sql" };

export function normalizeLanguage(lang: string): string {
  const l = lang.trim().toLowerCase();
  return ALIASES[l] ?? l;
}

const LINE_COMMENT: Record<string, string> = { python: "#", sql: "--" };

export function tokenize(code: string, language: string): Token[] {
  const lang = normalizeLanguage(language);
  const words = KEYWORDS[lang];
  if (!words) return [{ text: code, kind: "plain" }];
  const keywords = new Set(lang === "sql" ? words.split(" ").map((w) => w.toLowerCase()) : words.split(" "));
  const line = LINE_COMMENT[lang] ?? "//";
  const block = lang === "python" || lang === "sql" ? null : ["/*", "*/"];
  const out: Token[] = [];
  let plain = "";
  const push = (text: string, kind: TokenKind) => {
    if (plain) {
      out.push({ text: plain, kind: "plain" });
      plain = "";
    }
    out.push({ text, kind });
  };
  let i = 0;
  while (i < code.length) {
    const rest = code.slice(i);
    if (rest.startsWith(line)) {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      push(code.slice(i, stop), "comment");
      i = stop;
      continue;
    }
    if (block && rest.startsWith(block[0]!)) {
      const end = code.indexOf(block[1]!, i + 2);
      const stop = end === -1 ? code.length : end + 2;
      push(code.slice(i, stop), "comment");
      i = stop;
      continue;
    }
    const ch = code[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      const triple = lang === "python" && rest.startsWith(ch.repeat(3));
      const quote = triple ? ch.repeat(3) : ch;
      let j = i + quote.length;
      while (j < code.length && !code.startsWith(quote, j)) j += code[j] === "\\" ? 2 : 1;
      const stop = Math.min(code.length, j + quote.length);
      push(code.slice(i, stop), "string");
      i = stop;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)?.[0];
    if (word) {
      const key = lang === "sql" ? word.toLowerCase() : word;
      if (keywords.has(key)) push(word, "keyword");
      else if (/^[A-Z][a-z0-9]+[A-Za-z0-9]*$/.test(word) && lang !== "sql") push(word, "type");
      else plain += word;
      i += word.length;
      continue;
    }
    const num = /^\d+(\.\d+)?/.exec(rest)?.[0];
    if (num) {
      push(num, "number");
      i += num.length;
      continue;
    }
    plain += ch;
    i += 1;
  }
  if (plain) out.push({ text: plain, kind: "plain" });
  return out;
}
