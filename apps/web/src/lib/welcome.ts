import { useEffect, useState } from "react";
import type { PlanInfo } from "@orbit/types";
import { api } from "./api";

export type WelcomeGrant = NonNullable<PlanInfo["welcome"]>;

/**
 * What a new account gets free at sign-up, from the server (ORBIT_WELCOME_RESUME_CREDITS and
 * ORBIT_WELCOME_INTERVIEW_MINUTES decide it), or null until it answers or when it gives nothing.
 */
export function useWelcomeGrant(): WelcomeGrant | null {
  const [grant, setGrant] = useState<WelcomeGrant | null>(null);
  useEffect(() => {
    api
      .listPlans()
      .then((plans) => {
        const w = plans.find((p) => p.welcome)?.welcome;
        if (w && (w.resume_credits || w.interview_minutes)) setGrant(w);
      })
      .catch(() => undefined);
  }, []);
  return grant;
}
