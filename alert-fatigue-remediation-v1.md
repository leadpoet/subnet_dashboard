# Alert-fatigue remediation v1

## Decision

Prevent benchmark retry churn from creating a new critical Discord card for
every attempt, while preserving strict evidence requirements for a true
benchmark incident and for clearing it.

The source change must be safe against the production schema that exists at
deployment time. The deployment workflow does not apply Supabase migrations,
and persisted pending delivery rows are consumed independently of the
lifecycle planner. A migration-only `supersede` design therefore cannot be
the runtime safety boundary.

## Evidence and problem statement

- The alert identity included `<benchmark-date>:attempt:<n>`, so retries
  created separate incidents and separate open/cleared cards.
- Failed attempts with no exact publication correlation were currently treated
  as immediate critical incidents.
- `deliverDueIntents()` sends pending delivery rows directly; it can deliver
  recovery cards queued before a lifecycle-level suppression change.
- The deploy workflow releases source but does not apply repository
  migrations. Runtime behavior cannot require a newly-added transition or
  delivery status.
- The telemetry API already protects against timestamp-only correlation. That
  protection remains mandatory.

## Goals

1. Key benchmark incidents by the stable official benchmark date/run or bundle
   identity and failure class, never by retry attempt.
2. Treat unlinked, ambiguous, stale, and non-current failed attempts as
   diagnostic evidence only.
3. Open a warning only after two distinct, linked failed executions for the
   same official benchmark; make an official failed/stale benchmark critical.
4. Close only when an exact linked published success proves that same official
   benchmark succeeded. Do not introduce timestamp-only clearing.
5. Stop all standalone benchmark `CLEARED` Discord cards, including already
   pending delivery rows, without mutating live rows or relying on a migration.
6. Preserve delivery of unrelated incidents and of benchmark open/escalate/
   reminder messages.

## Non-goals

- Do not change scoring, promotion, rewards, allocations, emissions, or
  submissions.
- Do not weaken the exact publication/execution correlation rule.
- Do not redesign Discord threads or claim that an existing card can be edited:
  no Discord message or thread identifier is persisted today.
- Do not apply a Supabase migration, deploy, or mutate production rows in this
  change.

## Design

### Stable benchmark classification

Create one pure benchmark classification path used by the API observation
builder and alert evaluation. It must receive the official benchmark identity,
current execution, exact publication correlation, failure class, age, and raw
linked executions.

- The identity is the official benchmark date/run or immutable bundle identity;
  retry attempt is evidence, not identity.
- A linked failure must match the latest official execution and the immutable
  candidate/model lineage. Missing, ambiguous, prior, or timestamp-only
  matches count as zero linked failures.
- Count distinct linked failed execution IDs from the raw run group. Do not
  infer repeated failures from a grouping that collapses retry attempts.
- One linked failure is diagnostic only. Two linked failures yield warning.
  Official terminal failure or overdue/stale official benchmark yields
  critical.
- Only an exact linked published success can produce a recovery observation.

### Outbound recovery suppression

Implement a narrow, shared predicate for benchmark recovery suppression. It
must use structured incident family/action data whenever available. For legacy
rows, its fallback may match only the exact benchmark alert fingerprint shape
and the `recover` action; it must not suppress based on generic message text.

Apply the predicate at both boundaries:

1. The lifecycle/delivery planner must not schedule a benchmark recovery.
2. The final pending-outbox consumer must re-check each due intent before any
   network call. This is authoritative for delivery rows persisted before the
   source update.

The consumer must remain compatible with the existing schema. It must not
write a new `cancelled` or `suppressed` status before a separately deployed
schema change makes that safe. For now it may leave a suppressed benchmark
recovery pending and record bounded, non-secret diagnostic telemetry; repeated
polling is acceptable as a temporary cost. The exit criterion is a separately
authorized, schema-compatible cleanup migration after a production queue
inventory.

### Legacy cleanup and migration

No migration is included in this source release. The prior candidate added a
runtime-only `supersede` transition that old production check constraints do
not accept, so retaining it would make the source guard migration-dependent.
A future cleanup migration may be designed only after inventory and
disposable-PostgreSQL verification.

That later cleanup must target the exact legacy attempt-key incidents and their
corresponding pending recovery delivery rows. It must not broadly delete or
rewrite historical evidence, and it must not turn failed delivery rows into
successful rows. Until that operation is authorized and applied, the source
transport guard protects users from queued-card spam.

## Touched components

- `src/app/api/admin/research-lab/route.ts`: derive stable identity and raw
  distinct linked execution evidence.
- `src/lib/research-lab-alerts.ts`: evaluate warning/critical/recovery from
  exact, current evidence.
- `src/lib/research-lab-alert-lifecycle.ts`: do not create benchmark recovery
  delivery intents.
- `src/lib/research-lab-alert-monitor.ts`: block pending benchmark recoveries
  immediately before delivery; no webhook call for them.
- `src/lib/admin-research-lab-telemetry.ts`: retain strict correlation
  metadata needed by the classifier.
- `scripts/test-research-lab-alerts.mjs`,
  `scripts/test-research-lab-alert-lifecycle.mjs`, and
  `scripts/test-research-lab-alert-monitor.mjs`: regression coverage.
- No migration ships with this source guard. A later, separately authorized
  cleanup can target exact legacy attempt-key incidents and pending recovery
  rows after production inventory.

## Acceptance criteria

- Different attempts of the same official benchmark resolve to one incident
  fingerprint.
- Two distinct exact linked failures are warning; official terminal failure or
  staleness is critical; unlinked failures do not open incidents.
- A success with only timestamp proximity never clears an incident.
- A pre-existing pending benchmark recovery results in zero webhook calls,
  while a non-benchmark recovery and a benchmark open/escalate/reminder still
  deliver normally.
- The source suite passes against the old database transition/status schema.
- No source behavior depends on a migration, transition, or delivery status
  unavailable in the currently deployed schema.
- Alerts expose enough redacted diagnostic detail to distinguish suppressed
  queued recovery from a transport failure.

## Verification

1. Run focused evaluator, lifecycle, and monitor regression tests, including
   direct outbox-consumer tests for persisted pending recovery rows.
2. Run type checking and the project test/build gates used by pull-request CI.
3. Run `git diff --check` and inspect only task-owned staged paths for
   secrets and unrelated changes.
4. Before any later cleanup migration, test it against disposable PostgreSQL.
   Do not assume a source deployment applies it.
5. Perform a bounded read-only production queue/telemetry check when
   authenticated. An unauthenticated response is not evidence of an empty
   queue; record it as unverified.

## Rollout and rollback

Release the source guard first only after normal review and CI. Do not deploy
or apply the migration in this task. In a separately authorized rollout:

1. Inventory legacy attempt-key incidents and pending recovery rows.
2. Verify the source guard is active and benchmark recovery webhook traffic is
   zero.
3. Apply the additive cleanup migration once, with readback.
4. Confirm one complete official benchmark produces at most the expected
   warning/critical state and no standalone recovery card.

Retain the source guard until the pending queue is verified clear. Do not roll
back by deleting migration history or weakening exact correlation; revert only
the source behavior if a verified unrelated delivery regression requires it.
