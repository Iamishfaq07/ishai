// The question bank's files (apps/api/orbit_api/question_bank: company guides and role packs, checked by the API's
// schema) as three small modules for the web app, so each page ships only what it shows:
//   virtual:question-bank/names  every guide's display name by slug (the tab title; the main bundle)
//   virtual:question-bank/cards  name, aliases, group, summary and question count (the /companies and /roles lists)
//   virtual:question-bank/docs   one loader per file (a guide's own page fetches only its own JSON, as its own chunk)
// A file missing what the pages need fails the build here with its name; the full checks are the API's
// (`uv run python -m orbit_api.question_bank`), which its tests and start-up run too.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export const BANK_DIR = fileURLToPath(new URL("../api/orbit_api/question_bank", import.meta.url));
const KINDS = ["companies", "roles"] as const;
type Kind = (typeof KINDS)[number];

const ID = "virtual:question-bank/";
const MODULES = ["names", "cards", "docs"] as const;

interface Entry {
  slug: string;
  name: string;
  aliases: string[];
  group: string;
  market?: string;
  summary: string;
  questions: unknown[];
}

function files(kind: Kind): string[] {
  return readdirSync(join(BANK_DIR, kind))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(BANK_DIR, kind, f));
}

/** Every file of a kind, in file-name order (as the API reads them), with the fields the pages rely on checked. */
export function readBank(kind: Kind): Array<{ file: string; entry: Entry }> {
  return files(kind).map((file) => {
    const entry = JSON.parse(readFileSync(file, "utf8")) as Entry;
    const slug = file.replace(/\\/g, "/").split("/").pop()!.replace(/\.json$/, "");
    if (entry.slug !== slug || !entry.name || !entry.summary || !Array.isArray(entry.questions) || !entry.questions.length) {
      throw new Error(`question bank: ${kind}/${slug}.json is missing its slug, name, summary or questions`);
    }
    return { file, entry };
  });
}

function code(module: (typeof MODULES)[number]): string {
  const out: string[] = [];
  for (const kind of KINDS) {
    const all = readBank(kind);
    const name = kind === "companies" ? "company" : "role";
    if (module === "names") {
      out.push(`export const ${name}Names = ${JSON.stringify(Object.fromEntries(all.map(({ entry }) => [entry.slug, entry.name])))};`);
    } else if (module === "cards") {
      const cards = all.map(({ entry: e }) => ({
        slug: e.slug,
        name: e.name,
        aliases: e.aliases,
        group: e.group,
        ...(e.market ? { market: e.market } : {}),
        summary: e.summary,
        questions: e.questions.length,
      }));
      out.push(`export const ${kind} = ${JSON.stringify(cards)};`);
    } else {
      const loaders = all.map(({ file, entry }) => `${JSON.stringify(entry.slug)}: () => import(${JSON.stringify(file.replace(/\\/g, "/"))})`);
      out.push(`export const ${name}Docs = {\n${loaders.join(",\n")}\n};`);
    }
  }
  return out.join("\n");
}

export function questionBank(): Plugin {
  return {
    name: "orbit-question-bank",
    resolveId(id) {
      return id.startsWith(ID) && MODULES.includes(id.slice(ID.length) as (typeof MODULES)[number]) ? `\0${id}` : null;
    },
    load(id) {
      if (!id.startsWith(`\0${ID}`)) return null;
      for (const kind of KINDS) for (const file of files(kind)) this.addWatchFile(file);
      return code(id.slice(ID.length + 1) as (typeof MODULES)[number]);
    },
  };
}
