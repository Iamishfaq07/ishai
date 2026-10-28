/**
 * GitHub projects → resume (the pattern GitResume, Resummit and JobMentis' git-history skill follow): a user's public
 * repositories, read from GitHub's public API in the browser, ranked by how well they'd show on a resume, then turned
 * into project lines, a skills list and story prompts. Only facts GitHub has (name, description, language, topics,
 * stars, live link, last push) are used; results and numbers are left for the candidate to add.
 */

export interface Repo {
  name: string; description: string | null; language: string | null; topics: string[]; stars: number; forks: number;
  fork: boolean; archived: boolean; homepage: string | null; url: string; pushedAt: string;
}

export const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** "https://github.com/octocat/" or "@octocat" → "octocat"; null when it can't be a GitHub username. */
export function parseUsername(input: string): string | null {
  let value = input.trim();
  if (/^(?:www\.)?github\.com\//i.test(value)) value = `https://${value}`;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!["github.com", "www.github.com"].includes(url.hostname) || url.username || url.password || url.port) return null;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length !== 1) return null;
      value = decodeURIComponent(parts[0]!);
    } catch { return null; }
  } else value = value.replace(/^@/, "").replace(/\/$/, "");
  return USERNAME.test(value) ? value : null;
}

const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

export function toRepo(j: unknown): Repo | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const name = str(o.name), url = str(o.html_url);
  if (!name || name.length > 100 || !url || o.private === true) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.username || parsed.password
        || parsed.port || parsed.pathname.split("/").filter(Boolean).length !== 2) return null;
  } catch { return null; }
  const home = str(o.homepage);
  return {
    name, url, description: str(o.description), language: str(o.language),
    topics: Array.isArray(o.topics) ? o.topics.filter((t): t is string => typeof t === "string").slice(0, 10) : [],
    stars: num(o.stargazers_count), forks: num(o.forks_count), fork: o.fork === true, archived: o.archived === true,
    homepage: home && /^https?:\/\//.test(home) ? home : null, pushedAt: typeof o.pushed_at === "string" && Number.isFinite(Date.parse(o.pushed_at)) ? o.pushed_at : "",
  };
}

/** How well a repository would read on a resume: original work, described, used, live, recently touched. */
export function resumeScore(r: Repo, now = Date.now()): number {
  if (r.fork) return 0;
  const months = r.pushedAt ? (now - Date.parse(r.pushedAt)) / (30 * 86_400_000) : 99;
  return (r.description ? 3 : 0) + (r.homepage ? 2 : 0) + Math.min(4, Math.log2(1 + r.stars)) + Math.min(2, Math.log2(1 + r.forks))
    + (r.topics.length ? 1 : 0) + (months < 6 ? 2 : months < 18 ? 1 : 0) - (r.archived ? 1 : 0);
}

const pretty = (name: string) => name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const TOPIC_SKILL: Record<string, string> = {
  react: "React", nextjs: "Next.js", nodejs: "Node.js", django: "Django", flask: "Flask", fastapi: "FastAPI",
  "machine-learning": "Machine learning", "deep-learning": "Deep learning", pytorch: "PyTorch", tensorflow: "TensorFlow",
  docker: "Docker", kubernetes: "Kubernetes", aws: "AWS", firebase: "Firebase", mongodb: "MongoDB", postgresql: "PostgreSQL",
  tailwindcss: "Tailwind CSS", flutter: "Flutter", android: "Android", "spring-boot": "Spring Boot", llm: "LLMs", nlp: "NLP",
  "computer-vision": "Computer vision", graphql: "GraphQL", redis: "Redis", sql: "SQL", vue: "Vue", angular: "Angular",
};

/** A resume project entry from one repository: a title line and one bullet from GitHub's own facts. */
export function projectEntry(r: Repo): { title: string; bullet: string } {
  const stack = [...new Set([r.language, ...r.topics.map((t) => TOPIC_SKILL[t]).filter(Boolean)].filter(Boolean))].slice(0, 4) as string[];
  const title = `${pretty(r.name)}${stack.length ? ` · ${stack.join(", ")}` : ""}`;
  const what = r.description ? r.description.trim().replace(/\.$/, "") : `a ${r.language ?? "software"} project`;
  const lead = `Project description: ${what}`;
  const extras = [r.homepage && `live at ${r.homepage}`, r.stars >= 5 && `${r.stars} stars on GitHub`].filter(Boolean);
  return { title, bullet: `${lead}${extras.length ? `; ${extras.join(", ")}` : ""}. [Describe your own contribution and a result you can verify]` };
}

/** Languages and recognised topics across the chosen repositories, most used first. */
export function skillsFrom(repos: Repo[]): { skill: string; repos: number }[] {
  const m = new Map<string, number>();
  for (const r of repos) {
    const s = new Set([r.language, ...r.topics.map((t) => TOPIC_SKILL[t])].filter((x): x is string => Boolean(x)));
    for (const k of s) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([skill, n]) => ({ skill, repos: n })).sort((a, b) => b.repos - a.repos || a.skill.localeCompare(b.skill));
}

/** STAR prompts for telling a project's story in an interview; the answers are the candidate's. */
export function storyPrompts(r: Repo): string[] {
  return [
    `Situation: what problem does ${pretty(r.name)} address? Who is it for?`,
    `Task: what was your own responsibility, and what made it hard?`,
    `Action: what did you build yourself${r.language ? ` in ${r.language}` : ""}, and what did you decide along the way?`,
    "Result: who used it, what changed, and what would you do differently now?",
  ];
}
