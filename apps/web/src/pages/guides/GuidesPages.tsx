import { Fragment, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, BookOpen, ExternalLink, Info, cx, focusRing } from "@orbit/ui";
import { PublicLayout } from "../../marketing/PublicLayout";
import { Container, Eyebrow, IconTile } from "../../marketing/primitives";
import { NotFoundPage } from "../NotFound";
import { reviewedOn } from "../bank/content";
import { GUIDES_PATH, articleFor, guidePath, publishedArticles, type GuideArticle, type GuideBlock } from "./articles";

/**
 * Orbit's interview-prep articles (/guides and /guides/<slug>, content in articles.ts), on the public layout like the
 * company and role guides. Built to HTML at build time too (src/prerender), so search engines and assistants read the
 * whole article. A draft (`published: false`) shows a note saying so, and its page is noindex.
 */

const link = cx("font-medium text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300", focusRing);

/** Text with [words](/path) links inside the site; anything else stays text. */
function Rich({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[([^\]]+)\]\((\/[^)\s]*)\)/g)) {
    parts.push(text.slice(last, m.index));
    parts.push(
      <Link key={m.index} to={m[2]!} className={link}>
        {m[1]}
      </Link>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts.map((p, i) => (typeof p === "string" ? <Fragment key={`t${i}`}>{p}</Fragment> : p))}</>;
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case "p":
      return (
        <p className="mt-4 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
          <Rich text={block.text} />
        </p>
      );
    case "ul":
    case "ol": {
      const List = block.kind;
      return (
        <List className={cx("mt-4 space-y-2 pl-5 text-base leading-relaxed text-zinc-700 marker:text-zinc-500 dark:text-zinc-300", block.kind === "ol" ? "list-decimal" : "list-disc")}>
          {block.items.map((item) => (
            <li key={item}>
              <Rich text={item} />
            </li>
          ))}
        </List>
      );
    }
    case "example":
      return (
        <figure className="mt-5 rounded-2xl border mk-line mk-surface p-5">
          <figcaption className="text-sm font-semibold text-zinc-950 dark:text-white">{block.label}</figcaption>
          <blockquote className="mt-2 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">{block.text}</blockquote>
        </figure>
      );
    case "question":
      return (
        <div className="mt-5 rounded-2xl border mk-line mk-surface p-5">
          <h3 className="text-base font-semibold text-zinc-950 dark:text-white">{block.question}</h3>
          <p className="mt-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">A good answer covers</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-zinc-700 marker:text-zinc-500 dark:text-zinc-300">
            {block.covers.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {block.avoid && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">Avoid: </span>
              <Rich text={block.avoid} />
            </p>
          )}
        </div>
      );
  }
}

function Breadcrumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="pt-6 text-sm text-zinc-600 dark:text-zinc-400">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">/</span>}
            {item.to ? (
              <Link to={item.to} className={cx("rounded hover:text-zinc-900 hover:underline dark:hover:text-white", focusRing)}>
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-zinc-800 dark:text-zinc-200">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** One article. */
export function ArticleView({ article }: { article: GuideArticle }) {
  return (
    <PublicLayout context="Interview guides">
      <Container className="pb-20 pt-6 sm:pt-8">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Guides", to: GUIDES_PATH }, { label: article.headline }]} />
        <article aria-labelledby="article-title" className="max-w-3xl">
          <header className="pb-6 pt-8 sm:pt-12">
            <Eyebrow plain>
              <IconTile icon={BookOpen} size="sm" />
              Interview guide
            </Eyebrow>
            <h1 id="article-title" className="mk-h2 mt-5 text-zinc-950 dark:text-white">
              {article.headline}
            </h1>
            <p className="mk-lead mt-5 text-zinc-600 dark:text-zinc-300">{article.summary}</p>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              {article.published ? "Written and checked by the Orbit team, with AI help for the first draft." : "Written by the Orbit team, with AI help for the first draft."} Last
              reviewed {reviewedOn(article.reviewed)}.
            </p>
            {!article.published && (
              <p role="note" className="mt-4 flex gap-2 rounded-xl border mk-line p-3 text-sm text-zinc-700 dark:text-zinc-300">
                <Info className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
                Draft for review: not published yet, so it isn't in search results or linked from the site.
              </p>
            )}
          </header>
          {article.sections.map((s) => (
            <section key={s.id} aria-labelledby={`s-${s.id}`} className="pt-8">
              <h2 id={`s-${s.id}`} className="mk-h3 text-zinc-950 dark:text-white">
                {s.heading}
              </h2>
              {s.blocks.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </section>
          ))}
          {article.sources && article.sources.length > 0 && (
            <section aria-labelledby="sources-title" className="pt-10">
              <h2 id="sources-title" className="text-sm font-semibold text-zinc-950 dark:text-white">
                Sources
              </h2>
              <ul className="mt-2 space-y-1 text-sm">
                {article.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} rel="noopener noreferrer" className={cx("inline-flex items-center gap-1", link)}>
                      {s.title} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
        <nav aria-labelledby="next-title" className="mt-14 max-w-3xl border-t mk-line pt-10">
          <h2 id="next-title" className="mk-h3 text-zinc-950 dark:text-white">
            Next
          </h2>
          <ul className="mt-4 space-y-3">
            {article.related.map((r) => (
              <li key={r.to}>
                <Link to={r.to} className={cx("inline-flex items-center gap-1.5", link)}>
                  {r.label} <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </PublicLayout>
  );
}

/** /guides: the published articles, and the company and role guides. */
export function GuidesHubView({ articles = publishedArticles() }: { articles?: GuideArticle[] }) {
  return (
    <PublicLayout context="Interview guides">
      <Container className="pb-20 pt-6 sm:pt-8">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Guides" }]} />
        <header className="max-w-3xl pb-8 pt-8 sm:pt-12">
          <h1 className="mk-h2 text-zinc-950 dark:text-white">Interview guides</h1>
          <p className="mk-lead mt-5 text-zinc-600 dark:text-zinc-300">
            How to answer the questions most interviews ask, how companies interview, and what interviews for a job test.
          </p>
        </header>
        {articles.length > 0 && (
          <ul className="grid max-w-5xl gap-4 sm:grid-cols-2">
            {articles.map((a) => (
              <li key={a.slug}>
                <Link to={guidePath(a.slug)} className={cx("flex h-full flex-col rounded-2xl border mk-line mk-surface p-5", focusRing)}>
                  <span className="text-base font-semibold text-zinc-950 dark:text-white">{a.headline}</span>
                  <span className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{a.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-base">
          <Link to="/companies" className={link}>
            Company interview guides
          </Link>
          <Link to="/roles" className={link}>
            Interview guides by role
          </Link>
          <Link to="/warmup" className={link}>
            Free interview warm-up
          </Link>
        </p>
      </Container>
    </PublicLayout>
  );
}

export function GuidesHubPage() {
  return <GuidesHubView />;
}

export function GuideArticlePage() {
  const { slug = "" } = useParams();
  const article = articleFor(slug);
  return article ? <ArticleView article={article} /> : <NotFoundPage />;
}

