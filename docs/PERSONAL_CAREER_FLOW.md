# Personal career flow

## Candidate experience

- Career launchpad opens the current next action from owned saved records, with a direct link to the application or job preparation plan. Its priority matches Daily actions: past interviews, interviews within 24 hours, overdue follow-ups, application review/input, then other saved dates. No employment outcome is inferred.
- Without dated tasks, existing resume/contact/search guidance remains available. Interviews without a date now open an owned job's preparation workspace instead of an empty action queue.
- The Resume → Jobs → Apply → Interviews → Offer navigator jumps and focuses a section below the sticky header. Reduced-motion preferences disable smooth scrolling. Back to career steps restores focus to the navigator.
- The optional next-step plan is available on the launchpad. Visiting or refreshing the page never calls the model. The existing five-per-UTC-day quota, exact source quotes and before/after source checks apply.
- The launchpad refreshes recorded progress every minute while visible and on returning to the tab. It preserves a displayed plan only if the source version is unchanged. It skips automatic refresh while AI generation is running and cancels stale responses on unmount/selection change.
- Automate my reminders opens and focuses the existing follow-up settings, leaving rules off until the candidate explicitly saves them. Apply tools also expose adding an external job or interview. Offer tools expose recording the outcome.
- Daily actions includes a dedicated job follow-up filter.

## Naming

User-facing web navigation, tool cards, page headings, command-palette labels, pricing references, public page copy and search metadata use Resume, Jobs, Learning, LinkedIn, Coding practice, Copilot and Offers. AI capability descriptions remain where useful. Existing routes, identifiers, credit keys and bookmarks are preserved. Command-palette search accepts the old names too.

## Source boundaries

The launchpad progress API reads the same action queue as Daily actions. Grounded plan facts include static priority explanations and existing field/activity indicators; they exclude job titles, contact names, company details and notes. Server-generated links target owned records. The action queue revision participates in the plan source version, invalidating advice after relevant dates, statuses or rules change. No schema migration, external messages, automatic approval, submission or consent change is introduced.

## Review

1. Open `/jobs` with no resume; continue to the guided resume workbench.
2. Add an upcoming interview in the tracker. Return to the launchpad and open its next-step link.
3. Expand the optional AI plan and generate it; live providers use the configured backend provider. Browser tests use the labelled mock provider.
4. Change the tracker record in another tab and return. Check that the next action refreshes and an outdated plan disappears.
5. Use the five step buttons with keyboard and phone layouts. Check focus and header clearance.
6. Open Automate my reminders. Check that the settings open without enabling rules.
7. Open existing `/resume-ai`, `/learn`, `/linkedin`, `/offers` URLs and check simplified labels.
