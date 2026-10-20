# Guided resume to job search

## Candidate path

Career launchpad → **Add or edit a resume** opens a resume workbench at
`/jobs?work=resume`. It lists only owned resumes and provides guided creation,
import, section editing and search handoff. Following a creation/import link opens
the existing chooser; it does not create a record on a GET.

The editor's `?guide=1` mode presents seven steps:

1. Contact details and headline.
2. Education.
3. Projects.
4. Work experience (explicitly optional for freshers).
5. Skills.
6. Summary, including the existing reviewed AI rewrite.
7. Review, resume checks and **Save & continue to jobs**.

Next/Previous and the section selector retain the current resume edits. URL sections
support bookmarks and browser navigation. New education/project/work/skill entries
are revealed and focused after adding them. Skill group controls wrap on phones.

The mode reuses `ContentForm`, the same structured data, undo/redo, autosave queue,
revision conflict protection and local draft recovery. It does not introduce a
second resume representation. Only the selected form section renders; Full editor
retains certificates, extra sections, design, visibility controls and downloads.
Opening a targeted fix from the advanced checks uses Full editor so the target field
is available. A candidate can return to guided editing with the mode button.

The review indicators only report where text exists. They do not verify dates,
contact deliverability, skill ability, ATS compatibility or job readiness. Hidden
sections receive a reminder to check visibility. No experience or achievements are
filled in automatically, and candidates can skip inapplicable sections.

## Save before search

The final action sends the current snapshot through the existing serialized save
queue and waits for acknowledgement. Failures keep the candidate in the editor
with their local draft. Revision conflicts use the existing conflict UI. If edits
change during the save, navigation is refused until the latest edits are reviewed
and saved again. The form is disabled during this handoff; the snapshot comparison
also covers changes from other editor controls. If the candidate leaves the editor
while the save is pending, the save may finish but cannot navigate them back.

After acknowledgement, the editor opens `/jobs?start=1&resume_id=<owned id>`.
Search setup explicitly loads that resume instead of silently choosing another
profile/default resume. Search preferences still require the existing review/save;
this action does not approve application facts or enable auto-apply.

JSON Resume reading and exporting load on demand when the candidate selects those
file actions, keeping the resume home within its existing bundle budget.

## AI next-step companion

`/jobs?work=plan` opens a companion, also discoverable from Find a tool. The resume
workbench includes the same optional plan in a disclosure.

`GET /v1/jobs/launchpad/progress` derives indicators from the owned selected resume,
current preferences, tracker stages and applications needing attention. Blank list
rows and hidden sections do not count as visible details. Contact values and raw
resume content are not sent as plan facts: the model sees field-presence statements
and aggregate recorded activity.

The deterministic next action prioritizes prepared applications needing input and
recorded interview stages. Recorded offer/hired stages are labelled as self-reports.
They do not become independently verified outcomes or a hiring prediction. Other
next actions help add a resume, review contact details or choose/search for roles.

`POST /v1/jobs/launchpad/plan` requires verified email and the current source version.
The existing workflow AI service reserves a durable request before provider work,
limited to five requests per candidate per UTC day, including failed calls. Advice
must reference known fact IDs and quote their source text; unknown IDs, fabricated
quotes and duplicates are rejected. Paths come from the server's fact definitions,
never from model-provided URLs. Sources are checked again after generation.

Advice is still AI prose for candidate review. It cannot edit resumes, contacts,
preferences, application consent or tracker status. Mock responses are labelled as
demo plans. A populated field is not proof that a resume is complete or suitable.

## Verification

API tests cover ownership, contact-value minimization, blank/hidden sections,
no-resume plans, self-reported outcomes, invalid model output, durable failure quotas
and changes during generation. Browser tests exercise desktop and 360px phone
editing, optional experience, adding sections, saving, handoff to the same resume,
search review, grounded plan links and recovery from a failed save.

Paid live AI generation is not exercised by the deterministic test provider.
