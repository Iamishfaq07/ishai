import { PageTitle, useCompany } from "./BusinessApp";
import { BusinessRolloutPlanner, BusinessToolDirectory } from "./BusinessRollout";
import { BusinessWorkspaceHero } from "./WorkspaceIllustration";

export function BusinessLaunchpad() {
  const { company } = useCompany();
  return <div className="space-y-10">
    <PageTitle title="Business launchpad" subtitle="Plan a rollout, discover tools and find the right workspace for your team." />
    <BusinessWorkspaceHero kind="launchpad" />
    <section aria-labelledby="launchpad-plan-title"><h2 id="launchpad-plan-title" className="text-xl font-semibold">Build your rollout plan</h2><BusinessRolloutPlanner company={company} /></section>
    <section aria-labelledby="launchpad-tools-title"><h2 id="launchpad-tools-title" className="text-xl font-semibold">Explore your Business toolkit</h2><BusinessToolDirectory company={company} /></section>
  </div>;
}
