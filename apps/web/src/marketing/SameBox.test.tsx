import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SameBox } from "./SameBox";

/** Stands in for a component such as react-router's Link. */
function Fancy({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <a href="/pricing" className={className}>
      {children}
    </a>
  );
}

const note = (n: number | null) => (
  <p>
    <strong className="font-medium">Live sessions use interview minutes.</strong> {n ? `A new account gets ${n} free; ` : ""}more come with a pack.{" "}
    <Fancy className="underline">See pricing</Fancy>
  </p>
);

describe("SameBox (a line's room kept until the server answers)", () => {
  it("lays the answered text out in the same cell, out of the page's text and the accessibility tree", () => {
    const html = renderToString(<SameBox like={note(20)}>{note(null)}</SameBox>);
    const [shown = "", sizer = ""] = html.split('<div aria-hidden="true" class="invisible [grid-area:1/1]">');
    expect(shown).toContain('<div class="grid"><div class="[grid-area:1/1]">');
    // The sizer: the same elements and classes, its words only in attributes drawn by ::before, and no link.
    expect(sizer).toContain('<p><strong class="font-medium"><span data-like="Live sessions use interview minutes." class="before:content-[attr(data-like)]"></span></strong>');
    expect(sizer).toContain('data-like="A new account gets 20 free; "');
    expect(sizer).toContain('<span class="underline"><span data-like="See pricing"');
    expect(sizer).not.toMatch(/href=|<a /);
    expect(sizer.replace(/<[^>]+>/g, "")).toBe("");
    // The words a reader or crawler gets are the line as it stands.
    expect(html.replace(/<[^>]+>/g, "")).toBe("Live sessions use interview minutes. more come with a pack. See pricing");
  });
});
