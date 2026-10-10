import type { SessionType } from "@orbit/types";
import { Briefcase, ClipboardCheck, Code2, Phone, Target, Users, type LucideIcon } from "@orbit/ui";

/** Each session type's icon, wherever sessions are listed (Home's recent sessions, Sessions). */
export const SESSION_TYPE_ICON: Record<SessionType, LucideIcon> = {
  interview: Briefcase,
  coding: Code2,
  meeting: Users,
  mock: Target,
  assessment: ClipboardCheck,
  phone: Phone,
};
