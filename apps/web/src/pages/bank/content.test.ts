import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { companies, roles } from "virtual:question-bank/cards";
import { BANK_DIR } from "../../../questionBank";
import {
  COMPANY_GROUPS,
  ROLE_GROUPS,
  companyMockLink,
  firstSentence,
  parseTrack,
  related,
  roleMockLink,
  searchCards,
  searchKey,
  warmupItems,
  warmupLink,
} from "./content";
import type { BankCompany, BankRole } from "./types";

const read = <T,>(kind: "companies" | "roles"): T[] =>
  readdirSync(join(BANK_DIR, kind))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(BANK_DIR, kind, f), "utf8")) as T);
const allCompanies = read<BankCompany>("companies");
const allRoles = read<BankRole>("roles");

/** Every string in a value, deeply. */
const strings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];

// The same claims the API's checks refuse (orbit_api/question_bank/schema.py), as the pages show the text.
const OVERCLAIMS = [
  /\bleaked\b/i,
  /\b(actual|real|exact|genuine)\s+(interview\s+)?questions?\b/i,
  /\bquestions?\s+(that\s+(were|are)\s+)?asked\s+(at|by|in)\b/i,
  /\b(recently|previously|frequently)\s+asked\b/i,
  /glassdoor|leetcode|geeksforgeeks|ambitionbox|prepinsta/i,
  /deep\s*seek/i,
  /\bundetectable\b/i,
];

describe("the question bank's files, as the web app reads them", () => {
  it("has about a hundred companies and thirty roles, with unique addresses", () => {
    expect(companies.length).toBeGreaterThanOrEqual(95);
    expect(roles.length).toBeGreaterThanOrEqual(30);
    for (const cards of [companies, roles]) expect(new Set(cards.map((c) => c.slug)).size).toBe(cards.length);
    expect(allCompanies.length).toBe(companies.length);
    expect(allRoles.length).toBe(roles.length);
  });

  it("puts every guide in a section the list pages show", () => {
    const companyGroups = new Set(COMPANY_GROUPS.map(([g]) => g));
    const roleGroups = new Set(ROLE_GROUPS.map(([g]) => g));
    for (const c of companies) expect(companyGroups.has(c.group as never), c.slug).toBe(true);
    for (const r of roles) expect(roleGroups.has(r.group as never), r.slug).toBe(true);
  });

  it("has no empty section and no question without what a good answer covers", () => {
    for (const e of [...allCompanies, ...allRoles]) {
      expect(e.summary.length, e.slug).toBeGreaterThan(80);
      for (const list of [e.rounds, e.looks_for, e.tips, e.questions]) expect(list.length, e.slug).toBeGreaterThanOrEqual(2);
      for (const q of e.questions) {
        expect(q.text.trim(), e.slug).toBe(q.text);
        expect(q.covers.length, q.text).toBeGreaterThanOrEqual(2);
        expect(["behavioral", "role", "fit"]).toContain(q.type);
        expect(["intro", "story", "motivation", "knowledge", "situational", "reflection", "case", "closing"]).toContain(q.kind);
      }
      for (const s of strings(e)) expect(s.trim().length, e.slug).toBeGreaterThan(0);
    }
  });

  it("never claims a question is real, leaked or from a question site", () => {
    for (const e of [...allCompanies, ...allRoles]) {
      for (const s of strings(e)) for (const re of OVERCLAIMS) expect(re.test(s), `${e.slug}: ${s}`).toBe(false);
    }
  });

  it("never gives two companies (or two roles) the same name", () => {
    for (const list of [allCompanies, allRoles]) {
      const seen = new Map<string, string>();
      for (const e of list) {
        for (const n of new Set([e.name, e.slug.replace(/-/g, " "), ...e.aliases].map(searchKey))) {
          expect(seen.get(n) ?? e.slug, `${n}: ${seen.get(n)} and ${e.slug}`).toBe(e.slug);
          seen.set(n, e.slug);
        }
      }
    }
  });
});

describe("the guides' search, links and warm-up questions", () => {
  it("finds a company by its name, an alias or the start of a word", () => {
    expect(searchCards(companies, "aws")[0]?.slug).toBe("amazon");
    expect(searchCards(companies, "Tata Consultancy").map((c) => c.slug)).toContain("tcs");
    expect(searchCards(companies, "gold").map((c) => c.slug)).toContain("goldman-sachs");
    expect(searchCards(companies, "  ")).toHaveLength(companies.length);
    expect(searchCards(companies, "zzzz")).toEqual([]);
    expect(searchCards(roles, "sde").map((c) => c.slug)).toContain("software-engineer");
  });

  it("links each guide on to others in its group, never itself", () => {
    const next = related(companies, "tcs");
    expect(next.length).toBeGreaterThan(0);
    expect(next.length).toBeLessThanOrEqual(6);
    expect(next.every((c) => c.group === "it-services" && c.slug !== "tcs")).toBe(true);
    expect(related(companies, "no-such-company")).toEqual([]);
  });

  it("starts Practice and the warm-up on the guide", () => {
    expect(companyMockLink({ name: "Goldman Sachs" })).toBe("/mock?company=Goldman+Sachs");
    const analyst = allRoles.find((r) => r.slug === "data-analyst")!;
    expect(roleMockLink(analyst)).toBe("/mock?role=Data+analyst&type=technical&persona=hiring_manager&customise=1");
    expect(warmupLink("company", "tcs")).toBe("/warmup?track=company%3Atcs");
    expect(parseTrack("company:goldman-sachs")).toEqual({ kind: "company", slug: "goldman-sachs" });
    for (const bad of ["", "company:", "job:tcs", "company:../x", "role:Data"]) expect(parseTrack(bad)).toBeNull();
    const items = warmupItems("tcs", allCompanies.find((c) => c.slug === "tcs")!.questions);
    expect(items[0]).toMatchObject({ id: "tcs-1", text: "Tell me about yourself." });
    expect(items.every((q) => q.tip.startsWith("Cover: "))).toBe(true);
  });

  it("shortens a summary to its first sentence for a card", () => {
    expect(firstSentence("One thing. Two things.")).toBe("One thing.");
    expect(firstSentence("x".repeat(300)).length).toBeLessThanOrEqual(160);
  });
});
