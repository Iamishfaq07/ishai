import { describe, expect, it } from "vitest";
import type { PacketAnswer } from "./contract";
import { asBoolean, declineOption, isConsent, isEeo, matchAnswer, normalize, pickOption, pickOptions } from "./match";
import { pickPlace } from "./engine";
import { nextDelay, MIN } from "./schedule";

const a = (label: string, value: PacketAnswer["value"], question_id?: string): PacketAnswer => ({ label, value, question_id, kind: "text", source: "bank" });

describe("matching questions to approved answers", () => {
  it("normalizes labels: case, punctuation, required marks, curly quotes, accents", () => {
    expect(normalize("What’s your  notice period?*")).toBe("what s your notice period");
    expect(normalize("Résumé ✱")).toBe("resume");
    expect(normalize("Gender Identity (optional)")).toBe("gender identity");
  });

  it("matches by question id first, then the exact label, then the normalized label", () => {
    const answers = [a("Notice period", "30 days"), a("Why us?", "Because", "question_123"), a("Are you legally authorized to work in the US?", true)];
    expect(matchAnswer({ questionId: "question_123", label: "Something else" }, answers)?.value).toBe("Because");
    expect(matchAnswer({ questionId: "123", label: "" }, answers)?.value).toBe("Because"); // Greenhouse ids with or without the prefix
    expect(matchAnswer({ questionId: null, label: "Notice period" }, answers)?.value).toBe("30 days");
    expect(matchAnswer({ questionId: null, label: "NOTICE PERIOD*" }, answers)?.value).toBe("30 days");
    expect(matchAnswer({ questionId: null, label: "Are you legally authorized to work in the US" }, answers)?.value).toBe(true);
  });

  it("never guesses: a similar question is not the same question, and disagreeing matches are no match", () => {
    const answers = [a("Notice period", "30 days"), a("Expected salary", "20 LPA")];
    expect(matchAnswer({ questionId: null, label: "What is your notice period?" }, answers)).toBeNull();
    expect(matchAnswer({ questionId: null, label: "Expected salary range" }, answers)).toBeNull();
    expect(matchAnswer({ questionId: "q9", label: "" }, answers)).toBeNull();
    const twice = [a("Notice period", "30 days"), a("notice period", "60 days")];
    expect(matchAnswer({ questionId: null, label: "Notice Period" }, twice)).toBeNull();
  });

  it("picks options exactly or normalized, and yes/no from booleans", () => {
    const options = ["Yes", "No", "Decline To Self Identify"];
    expect(pickOption(options, "No")).toBe(1);
    expect(pickOption(options, "decline to self-identify")).toBe(2);
    expect(pickOption(options, true)).toBe(0);
    expect(pickOption(options, false)).toBe(1);
    expect(pickOption(["Yes, I consent", "No, I do not consent"], true)).toBe(-1); // not a plain yes: never guessed
    expect(pickOption(["India +91", "Indonesia +62"], "India")).toBe(-1);
    expect(pickOptions(["English (ENG)", "French (FRA)", "Hindi (HIN)"], ["Hindi (HIN)", "english (eng)"])).toEqual([2, 0]);
    expect(pickOptions(["English (ENG)"], ["English", "Klingon"])).toBeNull();
    expect(asBoolean("I agree")).toBe(true);
    expect(asBoolean("Maybe")).toBeNull();
  });

  it("picks a place only when it's unambiguous", () => {
    const places = ["Bengaluru, Karnataka, India", "Bengaluru Rural, Karnataka, India", "Bern, Switzerland"];
    expect(pickPlace(places, "Bengaluru")).toBe(0);
    expect(pickPlace(places, "Bengaluru, Karnataka, India")).toBe(0);
    expect(pickPlace(["India +91", "Indonesia +62"], "India")).toBe(0);
    expect(pickPlace(["Springfield, IL, USA", "Springfield, MA, USA"], "Springfield")).toBe(-1);
    expect(pickPlace(places, "Mumbai")).toBe(-1);
  });

  it("finds the decline-to-self-identify option in real EEO wordings", () => {
    expect(declineOption(["Male", "Female", "Decline To Self Identify"])).toBe(2);
    expect(declineOption(["I am not a protected veteran", "I identify as one or more of the classifications of protected veteran", "I don't wish to answer"])).toBe(2);
    expect(declineOption(["Yes, I have a disability", "No, I do not have a disability", "I do not want to answer"])).toBe(2);
    expect(declineOption(["Woman", "Man", "Prefer not to disclose"])).toBe(2);
    expect(declineOption(["English (ENG)", "Choose not to disclose"])).toBe(1);
    expect(declineOption(["Yes", "No"])).toBe(-1);
  });

  it("recognises voluntary EEO and consent questions", () => {
    for (const label of ["Gender", "Race and Ethnicity", "Are you Hispanic/Latino?", "Veteran Status", "Disability Status", "I consider myself a member of the LGBTQ+ community. (optional)"]) {
      expect(isEeo(label)).toBe(true);
    }
    expect(isEeo("What pronouns should we use?", "U.S. Equal Employment Opportunity information")).toBe(true);
    expect(isEeo("Are you legally authorized to work in the United States?")).toBe(false);
    expect(isConsent("I consent to the processing of my personal data")).toBe(true);
    expect(isConsent("I have read and agree to the privacy policy")).toBe(true);
    expect(isConsent("LinkedIn Profile")).toBe(false);
  });
});

describe("when the runner asks Orbit next", () => {
  const now = Date.parse("2026-10-19T10:00:00Z");
  const status = (next_due: string | null) => ({ today: 1, limit: 10, paused: false, next_due });
  it("waits for next_due within bounds, a person's gap after applying, and backs off on errors", () => {
    expect(nextDelay({ kind: "idle", status: status("2026-10-19T10:05:00Z") }, now)).toBe(5 * MIN);
    expect(nextDelay({ kind: "idle", status: status("2026-10-19T10:00:10Z") }, now)).toBe(2 * MIN);
    expect(nextDelay({ kind: "idle", status: status(null) }, now)).toBe(10 * MIN);
    expect(nextDelay({ kind: "limit", status: status("2026-10-20T03:00:00Z") }, now)).toBe(6 * 60 * MIN);
    expect(nextDelay({ kind: "not_before", at: now + 90_000 }, now)).toBe(90_000);
    expect(nextDelay({ kind: "after_apply" }, now, () => 0)).toBe(3 * MIN);
    expect(nextDelay({ kind: "after_apply" }, now, () => 0.999)).toBeLessThan(7 * MIN);
    expect(nextDelay({ kind: "error", failures: 1 }, now)).toBe(MIN);
    expect(nextDelay({ kind: "error", failures: 4 }, now)).toBe(8 * MIN);
    expect(nextDelay({ kind: "error", failures: 20 }, now)).toBe(30 * MIN);
  });
});
