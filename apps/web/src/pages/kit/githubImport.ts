import { resumeScore, toRepo, type Repo } from "./github";

/** Bounded pagination; report partial results rather than silently claiming a complete import. */
export async function importGitHub(user: string, signal: AbortSignal): Promise<{ repos: Repo[]; warning: string | null }> {
  const repos = new Map<string, Repo>();
  for (let page = 1; page <= 3; page++) {
    try {
      const res = await fetch(`https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&sort=pushed&type=owner&page=${page}`, { signal, headers: { Accept: "application/vnd.github+json" } });
      if (res.status === 404) throw new Error("No GitHub user with that name.");
      if (res.status === 403 || res.status === 429) throw new Error("GitHub is limiting requests. Try again later.");
      if (!res.ok) throw new Error("GitHub didn't answer. Try again.");
      const data: unknown = await res.json();
      if (!Array.isArray(data)) throw new Error("GitHub returned an unexpected response. Try again.");
      for (const item of data) { const repo = toRepo(item); if (repo) repos.set(repo.name, repo); }
      if (data.length < 100) return { repos: ranked(repos), warning: null };
    } catch (err) {
      if (signal.aborted) throw err;
      const message = err instanceof Error ? err.message : "Couldn't reach GitHub.";
      if (page === 1) throw new Error(message, { cause: err });
      return { repos: ranked(repos), warning: `Only some repositories loaded. ${message}` };
    }
  }
  return { repos: ranked(repos), warning: "Showing up to the 300 most recently pushed repositories. This account may have more." };
}
const ranked = (repos: Map<string, Repo>) => [...repos.values()].sort((a, b) => resumeScore(b) - resumeScore(a));
