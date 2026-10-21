import { Reveal } from "@orbit/ui";
import { Tool } from "../prepare/parts";
import { toolIcon, toolsFor, type Home } from "./homes";

/**
 * The rest of a tab's tools, from the catalogue: everything that belongs to this tab and isn't already on the page.
 * Renders nothing when the page already shows them all.
 */
export function MoreTools({ home, shown = [], title = "More tools here" }: { home: Home; shown?: readonly string[]; title?: string }) {
  const tools = toolsFor(home, shown);
  if (!tools.length) return null;
  return <section aria-labelledby={`more-tools-${home}`}>
    <h2 id={`more-tools-${home}`} className="font-semibold">{title}</h2>
    <Reveal as="ul" stagger className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{tools.map((t) =>
      <li key={t.id}><Tool t={{ title: t.name, detail: t.line, icon: toolIcon(t), to: t.href, ai: t.ai }} /></li>)}</Reveal>
  </section>;
}
