import { useEffect, useState } from "react";
import type { CreditPack, JobStats, MonthlyPlan } from "@orbit/types";
import { api } from "../../lib/api";
import { useWelcomeGrant, type WelcomeGrant } from "../../lib/welcome";

export interface PublicData {
  welcome: WelcomeGrant | null;
  packs: CreditPack[] | null;
  monthly: MonthlyPlan[] | null;
  stats: JobStats | null;
}

/**
 * What a product page says that only the server knows: the free allowance, the prices (for PricingSection) and the
 * public job numbers. Each is null until it answers, or if it can't; the built HTML has none of them, and says what
 * stays true without them.
 */
export function usePublicData({ prices = true }: { prices?: boolean } = {}): PublicData {
  const welcome = useWelcomeGrant();
  const [packs, setPacks] = useState<CreditPack[] | null>(null);
  const [monthly, setMonthly] = useState<MonthlyPlan[] | null>(null);
  const [stats, setStats] = useState<JobStats | null>(null);
  useEffect(() => {
    api.jobStats().then(setStats).catch(() => undefined);
    if (!prices) return;
    api.listPacks().then(setPacks).catch(() => undefined);
    api.listMonthly().then(setMonthly).catch(() => undefined);
  }, [prices]);
  return { welcome, packs, monthly, stats };
}
