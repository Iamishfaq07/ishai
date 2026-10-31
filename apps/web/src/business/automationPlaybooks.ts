import type { BizAutomationRecipe } from "@orbit/types";

export const AUTOMATION_RULES = [
  { key: "stalled_days", name: "Stalled pipeline", help: "Flag a candidate who has stayed in the same stage.", unit: "days", max: 90, initial: 3 },
  { key: "question_hours", name: "Candidate questions", help: "Follow up on each question still waiting for a reply.", unit: "hours", max: 168, initial: 24 },
  { key: "feedback_hours", name: "Interview feedback", help: "Collect missing panel feedback after the interview ends.", unit: "hours", max: 168, initial: 24 },
  { key: "assessment_hours", name: "Assessment review", help: "Review completed work samples, Saba interviews or alternative requests.", unit: "hours", max: 168, initial: 24 },
  { key: "scheduling_hours", name: "Interview time requests", help: "Reply when a candidate needs different interview times.", unit: "hours", max: 168, initial: 24 },
  { key: "prep_hours", name: "Interview preparation", help: "Before a booked interview, flag a missing active panel or saved interview criteria.", unit: "hours", max: 168, initial: 24 },
  { key: "offer_hours", name: "Offer response deadline", help: "Create an internal review task before the latest offer expires. Expired offers stay for review until answered or withdrawn.", unit: "hours", max: 168, initial: 24 },
  { key: "handoff_hours", name: "Accepted offer handoff", help: "Flag an accepted offer without a published joining plan while the application and role remain active.", unit: "hours", max: 168, initial: 24 },
] as const;
export type AutomationRuleKey = typeof AUTOMATION_RULES[number]["key"];
export interface PlaybookDraft { enabled: boolean; owner: string | null; thresholds: Record<AutomationRuleKey, string | null> }
export const AUTOMATION_PRESETS = [
  { id: "response", title: "Candidate response", detail: "Bring unanswered questions, scheduling requests and aging stages into the internal queue.", rules: { stalled_days: 3, question_hours: 24, scheduling_hours: 24 } },
  { id: "panel", title: "Panel readiness", detail: "Prepare upcoming interviews and follow up on missing feedback or completed assessments.", rules: { feedback_hours: 24, assessment_hours: 24, prep_hours: 24 } },
  { id: "offer", title: "Offer coordination", detail: "Review response deadlines and coordinate the accepted-offer joining-plan handoff.", rules: { offer_hours: 24, handoff_hours: 48 } },
] satisfies Array<{ id: string; title: string; detail: string; rules: Partial<Record<AutomationRuleKey, number>> }>;

export function playbookDraft(recipe: BizAutomationRecipe): PlaybookDraft {
  return { enabled: recipe.enabled, owner: recipe.default_assignee_id, thresholds: Object.fromEntries(AUTOMATION_RULES.map(rule => [rule.key, recipe[rule.key] === null ? null : String(recipe[rule.key])])) as PlaybookDraft["thresholds"] };
}
export function presetDraft(preset: typeof AUTOMATION_PRESETS[number], current: PlaybookDraft): PlaybookDraft {
  const rules: Partial<Record<AutomationRuleKey, number>> = preset.rules;
  return { enabled: false, owner: current.owner, thresholds: Object.fromEntries(AUTOMATION_RULES.map(rule => [rule.key, rules[rule.key] === undefined ? null : String(rules[rule.key])])) as PlaybookDraft["thresholds"] };
}
export function playbookIssues(draft: PlaybookDraft): string[] {
  return AUTOMATION_RULES.flatMap(rule => {
    const text = draft.thresholds[rule.key]; const value = Number(text);
    return text !== null && (!text.trim() || !Number.isInteger(value) || value < 1 || value > rule.max)
      ? [`${rule.name}: enter a whole number from 1 to ${rule.max} ${rule.unit}.`] : [];
  });
}
export function playbookRecipe(draft: PlaybookDraft): BizAutomationRecipe | null {
  if (playbookIssues(draft).length) return null;
  return { enabled: draft.enabled, default_assignee_id: draft.owner, ...Object.fromEntries(AUTOMATION_RULES.map(rule => [rule.key, draft.thresholds[rule.key] === null ? null : Number(draft.thresholds[rule.key])])) } as BizAutomationRecipe;
}
export function playbookKey(draft: PlaybookDraft): string {
  return JSON.stringify([draft.enabled, draft.owner, ...AUTOMATION_RULES.map(rule => draft.thresholds[rule.key])]);
}
