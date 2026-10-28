# SEO and page-experience audit

Reviewed 2026-10-28, following the workflow-reliability merge. This batch changes the web client only.

## Coverage

The static HTML scan inspected 156 generated HTML documents for descriptions, canonical tags, primary headings,
image alternatives and duplicate element IDs. The 150 prerendered page documents met those structural checks.
The other six files are the SPA shell, offline fallback and four policy documents. The shell gets its content
from the app; policy canonicals are supplied by the Worker. Those raw-file exceptions were not treated as defects.
Existing Worker/prerender tests cover route status, redirects, canonical metadata, robots rules, sitemap inclusion
and honest structured data. Client metadata now uses those same page definitions, including unpublished-guide noindex.

A loaded-page browser inventory checked the 31 personal routes below at 390 × 844. It waits for the page heading
and settled network activity before measuring, rather than measuring loading shells. Each recorded route had one
primary heading, a non-generic browser title and zero horizontal document overflow. Separate browser scenarios
exercise public/private metadata navigation, tool-search persistence, delayed AI fixes, current-text export, and
the resume format menu's bounds and Escape behavior. The mobile resume screenshot was visually inspected.

## Findings and changes

- Public SPA navigation retained another page's canonical/schema/social metadata. A route head resolver now
  replaces route-owned tags from the same definitions as static generation, and rejects stale asynchronous loads.
  Private views remove public schema/canonical tags and use noindex; preview hosts remain noindex.
- Several standalone tools lacked browser titles. Titles now cover those tools and missing administration views.
- Resume AI fixes could apply a layout or experience order after the source changed. Source checks now preserve
  candidate edits, and editor instances reset when switching resumes. Existing per-field suggestion validation remains.
- The ATS reading view could retain an older deferred preview or read an empty hidden preview. It now observes
  rendered text/layout changes and falls back to the current plain text when the preview is hidden.
- Clipboard failures lacked feedback. They now offer recovery guidance; the editor also exports current content
  as a text file for portals that require pasted text.
- The resume format menu could extend beyond the phone's left edge. Responsive alignment, viewport bounds,
  focus dismissal and Escape support fix that; selecting a format closes the menu.
- The tool catalogue counted disabled tools and lost search on reload. Counts now match available tools, queries
  live in the URL, and a clear-search action and result count are available.
- The public tool explorer bypassed the shared public layout. It now gets the consistent skip link, main landmark
  and site styling. The weekly studio now has a primary heading; the shared hero retains its secondary heading
  when embedded in the hiring control room.
- Jobs search metadata now describes the current application-review workflow rather than promising every Apply
  action merely opens the original post.

## Loaded personal-page inventory

| Route | Primary headings | Horizontal overflow |
| --- | ---: | ---: |
| `/` | 1 | 0 px |
| `/career` | 1 | 0 px |
| `/prepare` | 1 | 0 px |
| `/toolkit` | 1 | 0 px |
| `/sessions` | 1 | 0 px |
| `/documents` | 1 | 0 px |
| `/documents/stories` | 1 | 0 px |
| `/documents/answers` | 1 | 0 px |
| `/resume-ai` | 1 | 0 px |
| `/jobs` | 1 | 0 px |
| `/jobs/tracker` | 1 | 0 px |
| `/jobs/profile` | 1 | 0 px |
| `/jobs/auto-apply` | 1 | 0 px |
| `/jobs/journey` | 1 | 0 px |
| `/jobs/actions` | 1 | 0 px |
| `/jobs/weekly` | 1 | 0 px |
| `/jobs/priority` | 1 | 0 px |
| `/billing` | 1 | 0 px |
| `/settings` | 1 | 0 px |
| `/linkedin` | 1 | 0 px |
| `/learn` | 1 | 0 px |
| `/code` | 1 | 0 px |
| `/offers` | 1 | 0 px |
| `/aptitude` | 1 | 0 px |
| `/star-check` | 1 | 0 px |
| `/bullet-builder` | 1 | 0 px |
| `/career-gap` | 1 | 0 px |
| `/group-discussion` | 1 | 0 px |
| `/readiness` | 1 | 0 px |
| `/campus` | 1 | 0 px |
| `/github-projects` | 1 | 0 px |

## Follow-up coverage

Company-specific hiring views require role/team/job fixtures for a full visual audit. Camera/live-session flows,
real provider OAuth, real payment interfaces and production Core Web Vitals were not exercised in this batch.
Search Console crawl/indexing reports and production field measurements still need review after deployment.
Draft editorial pages remain unpublished/noindex until their content review is complete.
