import type { SessionType } from "@orbit/types";
import { Briefcase, ClipboardCheck, Code2, Phone, Target, Users, type LucideIcon } from "@orbit/ui";

/** Each session type's icon, wherever sessions are listed (Home's recent sessions, History). */
export const SESSION_TYPE_ICON: Record<SessionType, LucideIcon> = {
  interview: Briefcase,
  coding: Code2,
  meeting: Users,
  mock: Target,
  assessment: ClipboardCheck,
  phone: Phone,
};

/** "Interview · 7 Oct, 10:28 · 12 min": the parts a session has, without a dash for a length it doesn't. */
export function sessionLine(parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(" · ");
}
