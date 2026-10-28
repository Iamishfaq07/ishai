# Research: ownership and recurring Business guidance reviews

Primary material was read on 28 October 2026, extending the earlier
[knowledge workflow research](BUSINESS_KNOWLEDGE_RESEARCH.md). The selected gap was the work **after publication**:
who is responsible, when to check the document again, how to flag needed updates, and how to remind without
repeated notifications or silently elevating someone's authority.

| Source inspected | Useful observation | Product decision |
| --- | --- | --- |
| [Backstage overview](https://github.com/backstage/backstage/blob/master/README.md) and [catalog ownership semantics](https://github.com/backstage/backstage/blob/master/docs/features/software-catalog/descriptor-format.md#specowner-required) | `spec.owner` identifies ultimate responsibility and a point of contact; its documentation explicitly says ownership is not a runtime authorization grant. | Keep review ownership distinct from permissions. Assignment accepts existing active owners/admins and does not change role or publication audience. Recheck eligibility before reminders. |
| [BookStack overview](https://github.com/BookStackApp/BookStack/blob/development/readme.md) | A self-hosted documentation platform with published release/versioning guidance; its current GitHub README points to the Codeberg project. | Preserve published history and explicit lifecycle actions. Use the existing Orbit library rather than installing another documentation stack. The reviewed README names MIT for BookStack and separate dependency licenses. |
| [Outline overview](https://github.com/outline/outline/blob/main/README.md) | A collaborative team knowledge base; the overview identifies BSL 1.1 licensing. | Add team coordination around the existing source of truth: assignment, review notes and a current review queue. No Outline source or runtime is copied or installed. |
| [Wiki.js overview](https://github.com/requarks/wiki/blob/master/README.md) | The inspected master README identifies the upcoming 3.0 release as beta and explicitly not for production use. | Do not present an arbitrary repository branch as a production-ready dependency. Build this bounded review workflow within the existing Business stack. |

The first BookStack/Wiki.js README paths returned 404; the working lowercase BookStack `readme.md` and Wiki.js
`master` source above were then read. These materials are primary project descriptions, not independent reliability
benchmarks. No third-party implementation was copied, and no new runtime dependency was introduced.

## Implemented workflow

The release connects ownership → due queue → explicit human review → versioned confirmation or update request.
Opt-in internal reminders use a persistent episode key and the company lock. AI can review bounded publication/draft
excerpts and quote its evidence, but it cannot perform the confirmation. An update request propagates into knowledge
answers so readers see that the guidance needs attention, even before its calendar review date passes.

[Policy review inbox documentation](BUSINESS_KNOWLEDGE_REVIEWS.md) describes the actual permissions, scheduling,
limits, source validation, migration and local test results. The shipped confirmation path preserves private draft
text and audiences; it does not turn unsaved proposals into published policy.

## Follow-up work requiring separate design

- Team/group responsibility with explicit delegation, membership changes and backup owners, without treating
  ownership metadata as an authorization grant.
- Role-specific read acknowledgements tied to publication versions, separate from evidence that a document is
  correct or that a person is qualified for a hiring decision.
- Opt-in reminder escalation and digests with preferences, timezone policy and recovery after missed schedules.
- Links from submitted hiring requests to the exact policy versions reviewed, with a defined policy-change
  invalidation rule for pending approvals.
- Employer-approved AI review evaluation data: useful change detection, supported quotations, omitted context,
  misleading reassurance and multilingual documents. Mock tests do not establish live-model quality.

These are future proposals, not enabled integrations. Orbit Personal behavior is unchanged.
