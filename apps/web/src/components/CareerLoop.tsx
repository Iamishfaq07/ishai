import { useSearchParams } from "react-router-dom";
import { OrbitCareerLoopHero } from "@orbit/ui";
import { useAuth } from "../lib/auth";
import { cleanPrepContext, prepParams, readPrepContext } from "../lib/prepContext";
import { loadAnswers } from "../lib/onboarding";

export function CareerLoop() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  let context;
  try { context = readPrepContext(params, user?.id, sessionStorage); }
  catch { context = readPrepContext(params, user?.id); }
  context = cleanPrepContext({ ...context, role: context.role || (user ? loadAnswers(user.id)?.role : "") });
  const query = prepParams(context).toString();
  const path = (value: string) => query ? `${value}${value.includes("?") ? "&" : "?"}${query}` : value;
  return <OrbitCareerLoopHero links={{ jobs: path("/jobs"), resume: path("/resume-ai"), practice: path("/mock"), coding: path("/start?type=coding") }} />;
}
