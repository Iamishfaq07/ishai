// The job description editor's HTML: what the toolbar may make, cleaned the same way the API cleans it (the API is
// the one that counts; this keeps the editor from showing what would be dropped on save). Uses the browser's own
// parser (DOMParser), never innerHTML on a live element.

export const ALLOWED_TAGS = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI", "H3", "H4", "A", "BLOCKQUOTE"]);
const RENAME: Record<string, string> = { B: "strong", I: "em", DIV: "p", H1: "h3", H2: "h3", H5: "h4", H6: "h4" };

export function safeHref(href: string | null): string | null {
  if (!href) return null;
  const h = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : null;
}

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

function walk(node: Node): string {
  if (node.nodeType === 3) return escapeText(node.textContent ?? "");
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "NOSCRIPT", "SVG", "MATH"].includes(tag)) return "";
  const inner = Array.from(el.childNodes).map(walk).join("");
  const name = RENAME[tag] ?? (ALLOWED_TAGS.has(tag) ? tag.toLowerCase() : null);
  if (!name) return inner; // unknown tags go, their text stays
  if (name === "br") return "<br>";
  if (name === "a") {
    const href = safeHref(el.getAttribute("href"));
    return href ? `<a href="${escapeAttr(href)}" rel="nofollow noopener" target="_blank">${inner}</a>` : inner;
  }
  return `<${name}>${inner}</${name}>`;
}

/** Cleaned HTML: only ALLOWED_TAGS, no attributes but a link's http(s)/mailto href. */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === "undefined") return escapeText(html);
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return Array.from(doc.body.childNodes).map(walk).join("").trim();
}

/** The plain text of description HTML (a length count, a summary). */
export function htmlText(html: string): string {
  if (typeof DOMParser === "undefined") return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Markdown from the AI writer → simple HTML (headings, bullets, paragraphs, bold/italic), when the API's own
 *  description_html isn't there. */
export function markdownToHtml(md: string): string {
  const inline = (s: string) =>
    escapeText(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      close();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const ul = /^[-*•]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      close();
      out.push(h[1]!.length <= 3 ? `<h3>${inline(h[2]!)}</h3>` : `<h4>${inline(h[2]!)}</h4>`);
    } else if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ul ?? ol)![1]!)}</li>`);
    } else {
      close();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  return out.join("");
}
