# Background workflow operations

The durable job queue powers session reports, resume tailoring, business ranking and job indexing.
Each running job now has a unique lease token and expiry. Completion, failure and graceful shutdown
can update a job only while that worker still owns the lease. Starting another API process recovers
expired work; it does not reset every running job. Legacy jobs without leases wait until their
existing ten-minute stale threshold. A crashed worker's attempt remains counted. Repeated lease
expiry exhausts the retry budget and produces a visible WorkerLeaseExpired failure.

Updating a running job's deduplication key with a different payload requests a follow-up run.
The current run keeps its lease; the newest payload runs afterward with a fresh retry budget.
Repeated updates coalesce. A graceful shutdown releases its own lease without spending an attempt,
including when a newer payload is waiting. A concurrent insertion no longer silently drops a newer
payload: enqueue_now retries the normal update path after a unique-key conflict.

Leases extend past the longest registered handler timeout plus a shutdown margin. Handlers must
honor cancellation. Processing remains at least once: a network request already issued by a dead
or suspended worker cannot be retracted by a lease. External side effects still require their own
idempotency or reconciliation rules. This does not make Gmail or job-application sending retryable.

## Operator console

The administrator account's overview includes Background workflows. It shows ready work, running
jobs, failed jobs, expired leases and the oldest ready timestamp. Refresh explicitly to read current
state. The latest 25 failures show workflow kind, attempts and a sanitized error category; payloads,
raw provider errors and lease tokens are not returned. The page reports truncation.

An administrator can record a reason and retry a failed session report or business indexing job.
The request must name the current failed timestamp. A stale/repeated request or a running workflow
is rejected, and successful retries write an admin.workflow_retry audit event. This is an explicit
operator action, with a rate limit; it never automatically replays every failure. Tailoring and other
workflows require their original product-specific recovery paths, because replay can consume credits
or need fresh inputs. Detailed diagnosis remains in restricted server logs.

Endpoints: GET /v1/admin/workflows and POST /v1/admin/workflows/{id}/retry.

## Rollout

Drain/stop old API workers, apply migration ec24d6e8f0b2, then start the updated API. Old workers do
not honor leases, so mixed worker versions are unsupported. The migration is additive and rollback
preserves legacy job payloads/statuses; stop workers before rollback as well. No production schema
is changed by adding this migration to the repository.

This improves queue coordination and operator recovery. Distributed tracing, SSO/SCIM, tenant-level
service objectives, webhook delivery ledgers and broader business-automation diagnostics remain
separate enterprise work.
