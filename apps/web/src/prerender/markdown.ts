// A public page as Markdown, for AI assistants and agents that read text rather than HTML (`/companies/tcs.md`, or the
// page itself asked for with `Accept: text/markdown`; worker/seo.js). Written at build time from the same HTML the
// page is built from, so the two never say different things. Only the page's <main>: the header, footer, buttons,
// icons and forms aren't content. A small converter for HTML we render ourselves, not a general one.
import type { Head } from "./seo";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'" };
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, name: string) => {
    if (name in ENTITIES) return ENTITIES[name]!;
    if (/^#x/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return m;
  });

/** Where a page's Markdown copy goes among the built files, and its address: "/" → index.md, "/companies/tcs" →
 *  companies/tcs.md. */
export const markdownFile = (path: string): string => (path === "/" ? "index.md" : `${path.slice(1)}.md`);
export const markdownPath = (path: string): string => `/${markdownFile(path)}`;

/** The page's <main>, or the whole body when it has none. */
function mainOf(html: string): string {
  const start = html.search(/<main\b/i);
  if (start < 0) return html;
  const end = html.lastIndexOf("</main>");
  return html.slice(start, end > start ? end : undefined);
}

const inline = (s: string): string => s.replace(/[ \t\r\n]+/g, " ");

export function htmlToMarkdown(html: string, base: string): string {
  let s = mainOf(html);
  // What isn't content: drawings, scripts, controls, forms and what's hidden from people.
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of ["script", "style", "svg", "button", "form", "noscript", "template", "select", "textarea", "dialog"]) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"), "");
  }
  // The attributes only (React writes `hidden=""`), never a class name like Tailwind's "hidden md:block".
  s = s.replace(/<(\w+)\b[^>]*\s(?:aria-hidden="true"|hidden="")[^>]*>[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<(?:input|img|br|hr)\b[^>]*>/gi, (m) => (/^<br/i.test(m) ? "\n" : /^<hr/i.test(m) ? "\n\n---\n\n" : ""));

  // Links: absolute, and only when they go somewhere (not "#").
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
    // Nested elements are separate words ("Windows app" + "Live help…"), and neighbouring links stay apart.
    const label = inline(text.replace(/<[^>]+>/g, " ")).trim();
    if (!label) return "";
    if (!href || href.startsWith("#") || /^javascript:/i.test(href)) return ` ${label} `;
    const abs = /^[a-z]+:/i.test(href) ? href : `${base}${href.startsWith("/") ? "" : "/"}${href}`;
    return ` [${label}](${decode(abs)}) `;
  });
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, text: string) => (text.trim() ? `**${text.trim()}**` : ""));
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, text: string) => (text.trim() ? `*${text.trim()}*` : ""));
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, text: string) => `\`${text}\``);

  // Blocks.
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, text: string) => {
    const t = inline(text.replace(/<[^>]+>/g, "")).trim();
    return t ? `\n\n${"#".repeat(Number(level))} ${t}\n\n` : "";
  });
  // Innermost items first. One that holds its own blocks (a question with its answer notes) stays a block, so its
  // heading and list come out as they are; a plain item becomes one line.
  const ITEM = /<li\b[^>]*>((?:(?!<li\b)[\s\S])*?)<\/li>/i;
  for (let m = ITEM.exec(s); m; m = ITEM.exec(s)) {
    const text = m[1]!;
    const flat = inline(text.replace(/<[^>]+>/g, " ")).trim();
    const nested = /<(?:h[1-6]|p|ul|ol)\b|\n- |\n#/i.test(text);
    s = s.slice(0, m.index) + (nested ? `\n\n${text}\n\n` : flat ? `\n- ${flat}` : "") + s.slice(m.index + m[0].length);
  }
  s = s.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_m, row: string) => {
    const cells = [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => inline(c[1]!.replace(/<[^>]+>/g, " ")).trim());
    return cells.length ? `\n| ${cells.join(" | ")} |` : "";
  });
  s = s.replace(/<\/?(?:p|div|section|article|header|footer|nav|aside|ul|ol|dl|table|thead|tbody|blockquote|figure|figcaption|details|summary|main)\b[^>]*>/gi, "\n\n");
  s = s.replace(/<dt\b[^>]*>([\s\S]*?)<\/dt>/gi, (_m, t: string) => `\n\n**${inline(t).trim()}**\n`);
  s = s.replace(/<[^>]+>/g, "");
  s = decode(s);

  // Tidy: one space between words, no blank-line runs, the header row of each table marked.
  const lines = s.split("\n").map((l) => (l.startsWith("- ") || l.startsWith("| ") || l.startsWith("#") ? l : inline(l)).trim());
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line && !out[out.length - 1]) continue;
    // Repeated words from visually hidden labels sit on their own lines; keep a line only once in a row.
    if (line && line === out[out.length - 1]) continue;
    out.push(line);
    if (line.startsWith("| ") && !(out[out.length - 2] ?? "").startsWith("| ")) {
      const cols = line.split(" | ").length;
      out.push(`|${" --- |".repeat(cols)}`);
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The whole Markdown file: what the page is (title, address, description), then its content. */
export function pageMarkdown(head: Head, html: string, base: string, lastmod?: string): string {
  const body = htmlToMarkdown(html, base);
  const lines = [
    "---",
    `title: ${JSON.stringify(head.title)}`,
    `description: ${JSON.stringify(head.description)}`,
    `canonical: ${head.canonical}`,
    ...(lastmod ? [`last_reviewed: ${lastmod}`] : []),
    "---",
    "",
    // A page whose content starts lower than an h1 still gets its title as one.
    ...(/^# /m.test(body) ? [] : [`# ${head.title}`, ""]),
    body,
    "",
  ];
  return lines.join("\n");
}
