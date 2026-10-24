import { Button, Card } from "../../components/ui";
import { downloadText } from "../../lib/prepPack";
import { projectNextSteps, reviewerWorksheet, type ProjectWork } from "./projects";

export function ProjectReviewPlan({ title, work, rubric }: { title: string; work: ProjectWork; rubric: readonly string[] }) {
  const steps = projectNextSteps(work, rubric);
  return <Card className="space-y-3"><h3 className="font-semibold">Your next project steps</h3>
    <p className="text-sm text-zinc-600 dark:text-zinc-400">Based on the sections you have filled in and your own checklist. This does not evaluate correctness or verify test results.</p>
    {steps.length ? <ol className="list-decimal space-y-3 pl-5">{steps.map((step) => <li key={step.id} className="text-sm"><p className="font-medium">{step.title}</p><p className="mt-1 text-zinc-600 dark:text-zinc-400">{step.action}</p></li>)}</ol>
      : <p role="status" className="text-sm">Your sections and self-checks are complete. Ask a reviewer to examine the work and record one improvement before treating it as evidence.</p>}
    <Button variant="secondary" onClick={() => downloadText("orbit-project-reviewer-worksheet.txt", reviewerWorksheet(title, work, rubric), "text/plain")}>Download reviewer worksheet</Button>
    <p className="text-xs text-zinc-500">The worksheet contains your project text. Review it before sending it to someone; downloaded copies cannot be revoked.</p>
  </Card>;
}
