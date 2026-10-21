import type { ResumeData } from "@orbit/types";

/**
 * A one-page personal website from the resume (in the spirit of JSON Resume themes): about, experience, projects,
 * skills, education and links, in one self-contained HTML file with no scripts, trackers or remote fonts. It works
 * offline and can be hosted for free (GitHub Pages, Netlify, Cloudflare Pages). Only what the resume says; nothing
 * is added. Every value is escaped and only http(s) and mailto links are kept.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function safeUrl(url: string): string | null {
  const u = url.trim();
  if (/^mailto:[^\s"'<>]+$/i.test(u)) return u;
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(u)) return `mailto:${u}`;
  const withScheme = /^https?:\/\//i.test(u) ? u : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(u) ? `https://${u}` : null;
  if (!withScheme) return null;
  try { const p = new URL(withScheme); return p.protocol === "http:" || p.protocol === "https:" ? p.href : null; } catch { return null; }
}

const range = (start: string, end: string, current = false) => [start, current ? "Present" : end].filter(Boolean).join(" – ");

export function buildPortfolio(data: ResumeData, accent = "#4f46e5"): string {
  const b = data.basics;
  const color = /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#4f46e5";
  const hidden = new Set(data.hidden ?? []);
  const links = [
    ...(b.email ? [{ label: "Email", url: b.email }] : []),
    ...b.links,
  ].map((l) => ({ label: l.label || l.url, href: safeUrl(l.url) })).filter((l): l is { label: string; href: string } => Boolean(l.href));

  const section = (title: string, body: string) => body.trim() ? `<section><h2>${esc(title)}</h2>${body}</section>` : "";
  const bullets = (items: string[]) => items.filter(Boolean).length ? `<ul>${items.filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";

  const experience = hidden.has("experience") ? "" : data.experience.map((e) => `<article><header><h3>${esc(e.title)}${e.company ? ` <span>· ${esc(e.company)}</span>` : ""}</h3><p class="meta">${esc([range(e.start, e.end, e.current), e.location].filter(Boolean).join(" · "))}</p></header>${bullets(e.bullets)}</article>`).join("");
  const projects = hidden.has("projects") ? "" : data.projects.map((p) => {
    const href = p.link ? safeUrl(p.link) : null;
    const name = href ? `<a href="${esc(href)}" rel="noopener">${esc(p.name)}</a>` : esc(p.name);
    return `<article class="card"><h3>${name}</h3>${p.description ? `<p>${esc(p.description)}</p>` : ""}${bullets(p.bullets)}</article>`;
  }).join("");
  const skills = hidden.has("skills") ? "" : data.skills.filter((g) => g.items.length).map((g) => `<div class="skills">${g.name ? `<p class="meta">${esc(g.name)}</p>` : ""}<ul class="tags">${g.items.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>`).join("");
  const education = hidden.has("education") ? "" : data.education.map((e) => `<article><h3>${esc([e.degree, e.field].filter(Boolean).join(", ") || e.school)}</h3><p class="meta">${esc([e.school, range(e.start, e.end), e.grade ?? ""].filter(Boolean).join(" · "))}</p>${e.details ? `<p>${esc(e.details)}</p>` : ""}</article>`).join("");
  const certs = hidden.has("certifications") ? "" : bullets(data.certifications.map((c) => [c.name, c.issuer, c.date].filter(Boolean).join(" · ")));

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(b.name || "Portfolio")}${b.headline ? ` · ${esc(b.headline)}` : ""}</title>
<meta name="description" content="${esc((b.summary || b.headline || "").slice(0, 160))}">
<style>
:root{--accent:${color};--bg:#fff;--fg:#18181b;--muted:#52525b;--line:#e4e4e7;--card:#fafafa}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--fg:#f4f4f5;--muted:#a1a1aa;--line:#27272a;--card:#18181b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:46rem;margin:0 auto;padding:4rem 1.25rem}a{color:var(--accent)}
.hero{border-bottom:1px solid var(--line);padding-bottom:2rem}.hero h1{font-size:clamp(2rem,6vw,3rem);line-height:1.1;margin:0;letter-spacing:-.02em}
.hero .headline{color:var(--accent);font-weight:600;margin:.5rem 0 0}.hero .loc{color:var(--muted);margin:.25rem 0 0}
.links{display:flex;flex-wrap:wrap;gap:.5rem;padding:0;margin:1.25rem 0 0;list-style:none}.links a{display:inline-block;padding:.35rem .8rem;border:1px solid var(--line);border-radius:999px;text-decoration:none;font-size:.9rem}
section{margin-top:2.5rem}h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 1rem}
h3{font-size:1.05rem;margin:0}h3 span{color:var(--muted);font-weight:500}.meta{color:var(--muted);font-size:.9rem;margin:.15rem 0 .5rem}
article{margin-bottom:1.5rem}ul{padding-left:1.2rem;margin:.4rem 0}li{margin:.2rem 0}
.grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))}.card{background:var(--card);border:1px solid var(--line);border-radius:.75rem;padding:1rem;margin:0}
.tags{display:flex;flex-wrap:wrap;gap:.4rem;list-style:none;padding:0}.tags li{background:var(--card);border:1px solid var(--line);border-radius:.4rem;padding:.15rem .55rem;font-size:.85rem;margin:0}
footer{margin-top:4rem;color:var(--muted);font-size:.8rem}
</style></head>
<body><main>
<header class="hero"><h1>${esc(b.name || "Your name")}</h1>${b.headline ? `<p class="headline">${esc(b.headline)}</p>` : ""}${b.location ? `<p class="loc">${esc(b.location)}</p>` : ""}
${links.length ? `<ul class="links">${links.map((l) => `<li><a href="${esc(l.href)}" rel="noopener">${esc(l.label)}</a></li>`).join("")}</ul>` : ""}</header>
${b.summary && !hidden.has("summary") ? section("About", `<p>${esc(b.summary)}</p>`) : ""}
${section("Experience", experience)}
${projects ? section("Projects", `<div class="grid">${projects}</div>`) : ""}
${section("Skills", skills)}
${section("Education", education)}
${section("Certifications", certs)}
<footer>Last updated ${esc(new Date().toLocaleDateString("en", { month: "long", year: "numeric" }))}.</footer>
</main></body></html>
`;
}
