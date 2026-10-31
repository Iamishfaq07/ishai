import { describe, expect, it } from "vitest";
import type { BizAutomationRecipe } from "@orbit/types";
import { AUTOMATION_PRESETS, AUTOMATION_RULES, playbookDraft, playbookIssues, playbookKey, playbookRecipe, presetDraft } from "./automationPlaybooks";

const saved: BizAutomationRecipe = { enabled: true, default_assignee_id: "coordinator", stalled_days: 3, question_hours: 24, feedback_hours: 24, assessment_hours: null, scheduling_hours: null, prep_hours: null, offer_hours: null, handoff_hours: null };
describe("Business automation playbook drafts", () => {
  it("roundtrips saved recipes and keeps field-order-independent comparison", () => {
    const draft = playbookDraft(saved);
    expect(playbookRecipe(draft)).toEqual(saved);
    expect(playbookKey(draft)).toBe(playbookKey(playbookDraft(Object.fromEntries(Object.entries(saved).reverse()) as unknown as BizAutomationRecipe)));
  });
  it("starts every preset disabled, preserves the owner and replaces all rule choices without changing the original", () => {
    const draft = playbookDraft(saved);
    for (const preset of AUTOMATION_PRESETS) {
      const next = presetDraft(preset, draft);
      expect(next.enabled).toBe(false); expect(next.owner).toBe("coordinator");
      expect(playbookIssues(next)).toEqual([]);
      expect(Object.keys(next.thresholds)).toHaveLength(AUTOMATION_RULES.length);
    }
    const offer = playbookRecipe(presetDraft(AUTOMATION_PRESETS[2]!, draft))!;
    expect(offer.offer_hours).toBe(24); expect(offer.handoff_hours).toBe(48); expect(offer.stalled_days).toBeNull();
    expect(saved.enabled).toBe(true); expect(draft.thresholds.stalled_days).toBe("3");
  });
  it("preserves empty enabled fields as invalid drafts rather than silently turning a rule off", () => {
    const draft = playbookDraft(saved); draft.thresholds.question_hours = "";
    expect(playbookIssues(draft)).toHaveLength(1);
    expect(playbookRecipe(draft)).toBeNull();
    expect(playbookKey(draft)).not.toBe(playbookKey(playbookDraft({ ...saved, question_hours: null })));
    draft.thresholds.question_hours = "48";
    expect(playbookRecipe(draft)?.question_hours).toBe(48);
  });
  it("rejects out-of-range, fractional and non-finite thresholds before a preview or save", () => {
    for (const value of ["0", "-1", "169", "1.5", "Infinity", "NaN"]) {
      const draft = playbookDraft(saved); draft.thresholds.feedback_hours = value;
      expect(playbookRecipe(draft)).toBeNull();
    }
    const draft = playbookDraft(saved); draft.thresholds.stalled_days = "91";
    expect(playbookRecipe(draft)).toBeNull();
    draft.thresholds.stalled_days = "90";
    expect(playbookRecipe(draft)?.stalled_days).toBe(90);
  });
});
