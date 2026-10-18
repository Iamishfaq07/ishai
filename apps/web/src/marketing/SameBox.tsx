import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { cx } from "@orbit/ui";

/**
 * Words that change when the server answers (what a new account gets, the day's free checks, a pack's price), drawn
 * from the first paint in the box they'll need once it has: `like` is that text with the server's usual values, laid
 * out invisibly in the same grid cell, so the cell is already its height and nothing under it moves when the answer
 * arrives (CLS; docs/PERFORMANCE.md). Its words are CSS generated content in a hidden, aria-hidden layer, so neither
 * a screen reader nor a crawler reading the built HTML gets them; `children` is the only text there is. Pass the
 * answer to `like` once it's known, so the box then fits it exactly. `answered` (anything that changes when the
 * answer arrives) draws the line afresh in its box, so its later words are replaced where they stand rather than
 * pushed along (the swap is a change of text, not text that moves).
 */
export function SameBox({ like, answered, children, className }: { like: ReactNode; answered?: unknown; children: ReactNode; className?: string }) {
  return (
    <div className={cx("grid", className)}>
      <div key={JSON.stringify(answered ?? null)} className="[grid-area:1/1]">
        {children}
      </div>
      <div aria-hidden="true" className="invisible [grid-area:1/1]">
        {ghost(like)}
      </div>
    </div>
  );
}

/** The same elements and classes, each piece of text moved into `::before` (not the document's text). A component
 *  (a Link) is drawn as a span with its classes, so the layer has nothing to follow or focus. */
export function ghost(node: ReactNode): ReactNode {
  return Children.map(node, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      return <span data-like={String(child)} className="before:content-[attr(data-like)]" />;
    }
    if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return null;
    const { className, children } = child.props;
    if (child.type === Fragment) return <>{ghost(children)}</>;
    const Tag = typeof child.type === "string" && child.type !== "a" ? (child.type as "span") : "span";
    return <Tag className={className}>{ghost(children)}</Tag>;
  });
}
