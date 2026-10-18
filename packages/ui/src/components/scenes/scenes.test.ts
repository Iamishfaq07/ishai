import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SceneProps } from "./parts";
import { AnswersScene } from "./AnswersScene";
import { BillingScene } from "./BillingScene";
import { CelebrationScene } from "./CelebrationScene";
import { CodeScene } from "./CodeScene";
import { CopilotScene } from "./CopilotScene";
import { DocumentsScene } from "./DocumentsScene";
import { EvidenceScene } from "./EvidenceScene";
import { InboxScene } from "./InboxScene";
import { InterviewDayScene } from "./InterviewDayScene";
import { JobsScene } from "./JobsScene";
import { KashSecScene } from "./KashSecScene";
import { LearningScene } from "./LearningScene";
import { LinkedInScene } from "./LinkedInScene";
import { NoResultsScene } from "./NoResultsScene";
import { OfferScene } from "./OfferScene";
import { OfflineScene } from "./OfflineScene";
import { PracticeScene } from "./PracticeScene";
import { ReferralScene } from "./ReferralScene";
import { ResumeScene } from "./ResumeScene";
import { SecurityScene } from "./SecurityScene";
import { StoriesScene } from "./StoriesScene";
import { TrackerScene } from "./TrackerScene";
import { VideoScene } from "./VideoScene";
import { WelcomeScene } from "./WelcomeScene";
import { WorkingScene } from "./WorkingScene";
import { SPOT_KINDS, Spot } from "./spots";

const SCENES: Record<string, ComponentType<SceneProps>> = {
  AnswersScene, BillingScene, CelebrationScene, CodeScene, CopilotScene, DocumentsScene, EvidenceScene, InboxScene,
  InterviewDayScene, JobsScene, KashSecScene, LearningScene, LinkedInScene, NoResultsScene, OfferScene, OfflineScene, PracticeScene,
  ReferralScene, ResumeScene, SecurityScene, StoriesScene, TrackerScene, VideoScene, WelcomeScene, WorkingScene,
};
const MOTION = ["scene-draw", "scene-fade", "scene-in", "scene-pop", "scene-settle"];
const render = (C: ComponentType<SceneProps>, props: SceneProps = {}) => renderToStaticMarkup(createElement(C, props));
const tags = (html: string) => html.match(/<[a-z]+\b[^>]*>/g) ?? [];
const classes = (tag: string) => (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);

describe.each(Object.entries(SCENES))("%s", (_, Scene) => {
  const html = render(Scene);

  it("is decorative unless it's given a title", () => {
    expect(html).toMatch(/^<svg[^>]*aria-hidden="true"/);
    expect(render(Scene, { title: "A picture" })).toMatch(/^<svg[^>]*role="img"[^>]*aria-label="A picture"/);
  });

  it("is flat: no gradient, filter or image", () => {
    expect(html).not.toMatch(/<(linearGradient|radialGradient|filter|image|foreignObject)\b/);
  });

  it("is its final frame without CSS: nothing starts hidden in the markup", () => {
    expect(html).not.toMatch(/opacity="0"|opacity:\s*0[;"]/);
  });

  it("marks each moving part once, never on an element with its own transform", () => {
    for (const tag of tags(html)) {
      const moving = classes(tag).filter((c) => MOTION.includes(c));
      expect(moving.length, tag).toBeLessThanOrEqual(1);
      if (moving.length) expect(tag, tag).not.toMatch(/\stransform="/);
      if (moving[0] === "scene-draw") expect(tag, tag).toMatch(/pathLength="1"/);
    }
  });
});

describe.each(SPOT_KINDS)("spot %s", (kind) => {
  const html = renderToStaticMarkup(createElement(Spot, { kind }));

  it("is decorative, flat, and its final frame without CSS", () => {
    expect(html).toMatch(/^<span aria-hidden="true" class="spot /);
    expect(html).not.toMatch(/<(linearGradient|radialGradient|filter|image|foreignObject|text)\b/);
    expect(html).not.toMatch(/opacity="0"|opacity:\s*0[;"]/);
  });

  it("has one accent part that plays, marked the scenes' way", () => {
    const moving = tags(html).filter((t) => classes(t).some((c) => MOTION.includes(c)));
    expect(moving.length).toBeGreaterThan(0);
    for (const tag of moving) {
      expect(classes(tag).filter((c) => MOTION.includes(c)).length, tag).toBe(1);
      expect(tag, tag).not.toMatch(/\stransform="/);
      if (classes(tag).includes("scene-draw")) expect(tag, tag).toMatch(/pathLength="1"/);
    }
  });
});

describe("Scene", () => {
  it("fills its box up to 15rem, unless a width is given", () => {
    expect(render(OfferScene)).toMatch(/class="scene [^"]*w-full max-w-\[15rem\]/);
    const sized = render(OfferScene, { className: "w-24 sm:w-40" });
    expect(sized).not.toMatch(/w-full/);
    expect(sized).toMatch(/w-24 sm:w-40/);
  });

  it("each kind of AI wait draws differently", () => {
    const kinds = (["reading", "writing", "matching"] as const).map((kind) => renderToStaticMarkup(createElement(WorkingScene, { kind })));
    expect(new Set(kinds).size).toBe(3);
    expect(kinds[0]).toContain("scene-scan");
    expect(kinds[1]).toContain("scene-write");
    expect(kinds[2]).toContain("scene-travel");
  });
});

describe("scene motion CSS", () => {
  const css = readFileSync(new URL("../../design/base.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("plays each part at Full, fades it at Gentle, and hides it before it's in view only when motion may play", () => {
    for (const c of MOTION) {
      expect(css).toMatch(new RegExp(`:root\\[data-motion="full"\\] \\.scene\\[data-shown\\] \\.${c} \\{\\s*animation:`));
    }
    const gentle = css.match(/:root\[data-motion="reduced"\] \.scene\[data-shown\] :is\(([^)]*)\)/)?.[1] ?? "";
    const hidden = css.match(/:root:is\(\[data-motion="full"\], \[data-motion="reduced"\]\) \.scene:not\(\[data-shown\]\) :is\(([^)]*)\)/)?.[1] ?? "";
    for (const c of MOTION) {
      expect(gentle).toContain(`.${c}`);
      expect(hidden).toContain(`.${c}`);
    }
  });

  it("loops only the AI-working parts, and only at Full", () => {
    const infinite = [...css.matchAll(/([^{}]+)\{[^{}]*animation:[^;]*infinite/g)].map((m) => m[1]!.trim());
    const scenes = infinite.filter((s) => s.includes(".scene"));
    expect(scenes.length).toBeGreaterThan(0);
    for (const s of scenes) {
      expect(s).toMatch(/^:root\[data-motion="full"\] \.scene \.scene-(scan|write|travel|breathe)$/);
    }
  });
});
