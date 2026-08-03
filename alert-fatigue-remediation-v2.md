# Alert-fatigue remediation v2

## Review findings to remediate

Fresh independent verification rejected v1 with three P1 defects and one P2:

1. The monitor selects only the oldest 50 pending deliveries before suppressing
   benchmark recoveries. If all 50 are permanently pending legacy recoveries,
   later unrelated alerts starve forever.
2. `benchmark_stalled` incidents can auto-recover by absence, without an
   exact linked published-success record. Strict closure currently protects
   only `benchmark_failed`.
3. A run with no `benchmark_date` but an exact linked bundle with a date gets
   two incompatible identities: the raw execution uses the bundle date while
   daily telemetry may use bundle ID. A true official failure is then treated
   as unlinked.
4. The warning threshold has an unused route-level constant and a separate
   hard-coded classifier literal.

## Goals

- Keep benchmark recovery Discord delivery at zero without starving ordinary
  alert delivery.
- Require exact linked publication success to close both failed and stalled
  benchmark incident forms.
- Use one canonical benchmark identity wherever daily telemetry, raw execution
  evidence, classification, fingerprints, and resolutions are built.
- Preserve old-schema compatibility: no migration, new status, new transition,
  new RPC, or production row mutation may be required.
- Keep the threshold policy in one place: one linked nonterminal failure is
  diagnostic, two distinct linked failures are warning, and a verified
  terminal/stale official benchmark is critical.

## Non-goals

- Do not mute benchmark failures wholesale.
- Do not alter benchmark scheduling, scoring, promotion, rewards, payments,
  allocation, emissions, weights, or publication semantics.
- Do not deploy, apply a migration, or mutate production in this task.
- Do not introduce a parallel alert system or Discord-thread redesign.

## Implementation design

### Starvation-free old-schema outbox selection

In `src/lib/research-lab-alert-monitor.ts`, replace the one limited pending
query with a deterministic internal scan:

1. Query only existing pending, due delivery rows, ordered by `due_at ASC`
   then `intent_id ASC`.
2. Fetch raw rows in 50-row `.range(offset, offset + 49)` pages.
3. Parse and classify each page before adding deliverable intents.
4. Skip benchmark recovery rows only for this poll; leave them pending and
   write no unsupported status or transition.
5. Advance by raw rows returned, not parsed or deliverable rows.
6. Stop only after collecting 50 deliverable intents or exhausting due rows.
7. Preserve the provider-adjacent predicate immediately before every network
   request as defense in depth.

This is source-only and compatible with existing delivery statuses. The
heartbeat must report the number of suppressions encountered during this scan.

### Strict closure for the benchmark family

Add a pure benchmark-family predicate in
`src/lib/research-lab-alerts.ts` that matches only:

- `scope === 'benchmark'`
- `signal === 'benchmark_failed' || signal === 'benchmark_stalled'`

Use it in `src/lib/research-lab-alert-lifecycle.ts` for absence handling and
recovery delivery suppression. For any failed/stalled benchmark incident that
is not in the exact resolution set, absence must preserve the current
pending/open state. Existing transitions are sufficient when an exact
resolution is present:

- pending incident: `debounce_cancel`
- open incident: `recover`

In `src/app/api/admin/research-lab/route.ts`, when exact evidence proves a
published success for the current official benchmark, emit resolution
fingerprints for both:

- `benchmark_failed:benchmark:<canonical-id>`
- `benchmark_stalled:benchmark:<canonical-id>`

No generic completion, timestamp proximity, unrelated bundle, different
execution, degraded telemetry, or mismatched lineage may produce either
resolution.

### One canonical benchmark identity

Add a small shared pure resolver in
`src/lib/research-lab-alerts.ts`, then call it from daily telemetry and raw
alert-execution construction in `src/app/api/admin/research-lab/route.ts`.
Its ordered inputs are:

1. Valid run benchmark date.
2. Valid date from the exact linked bundle.
3. Immutable exact bundle ID.
4. Exact rolling-window hash.
5. The existing final `daily-benchmark` fallback.

The resolver must receive exact correlation context. An unrelated latest
report cannot override an exact event/bundle identity. Contradictory values
continue to fail closed under the existing exact-correlation checks.

### One warning-threshold owner

Move `MIN_LINKED_BENCHMARK_FAILURES_FOR_WARNING = 2` next to
`classifyResearchLabBenchmarkAlert()` in
`src/lib/research-lab-alerts.ts`, use it for the comparison, and remove the
unused route-level constant.

## Required regression coverage

### Saturated pending queue

In `scripts/test-research-lab-alert-monitor.mjs`:

- Make the fake Supabase query honor ordering, `.range()`, due/status
  filtering, and deterministic pages.
- Seed 50 older suppressed benchmark recoveries followed by an unrelated due
  recovery at row 51.
- Assert a second page is read and row 51 is delivered in the same run.
- Assert exactly one provider call and successful update for row 51.
- Assert every suppressed row remains pending and receives no update.
- Assert no unsupported delivery status/transition is written.
- Assert heartbeat suppression count is 50.
- Retain negative tests showing benchmark open/escalate/remind and unrelated
  recoveries still deliver.

### Strict stalled closure

In `scripts/test-research-lab-alert-lifecycle.mjs`:

- Open a `benchmark_stalled` incident, then present a failed/no benchmark
  snapshot without exact publication success.
- Assert it remains open with no recover transition or delivery intent.
- Assert a failed-only resolution cannot close the stalled fingerprint.
- Supply exact linked-success resolutions for both stable fingerprints.
- Assert both forms resolve via existing lifecycle transitions and produce no
  benchmark recovery delivery.
- Retain absence auto-recovery coverage for unrelated alerts.

### Missing run date with exact dated bundle

In `scripts/test-research-lab-alerts.mjs`:

- Construct a run with no `benchmark_date`.
- Link it exactly through a durable event to a bundle dated `2026-08-03`.
- Assert daily telemetry, raw execution evidence, classifier, fingerprint,
  and later resolution all use `2026-08-03`.
- Assert a terminal linked failure remains critical.
- Assert exact published success for the same execution/bundle produces the
  expected failed and stalled resolutions.
- Include negative mismatched-bundle, contradictory-lineage, and
  timestamp-only-publication controls.

### Threshold ownership and compatibility

- Preserve one-linked and two-distinct-linked threshold assertions.
- Add a focused source/lint assertion that no unused route constant and
  hard-coded classifier comparison coexist.
- Verify no task file adds migration SQL, unsupported statuses, or unsupported
  lifecycle transitions.

## Verification required

Run after implementation:

```powershell
node scripts/test-research-lab-alerts.mjs
node scripts/test-research-lab-alert-lifecycle.mjs
node scripts/test-research-lab-alert-monitor.mjs
npx tsc --noEmit -p tsconfig.json
npx next lint --max-warnings=100000
npm test
$env:NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co'
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY='ci-anon-key'
npm.cmd run build
git diff --check
```

The full suite may have a Windows path-separator baseline failure before task
code; record that as unverified only after proving it is independent of this
diff. A restart rehearsal is not required because this task does not modify
the gateway, validator, auditor, restart, durable settlement, or weight
submission paths.

## Rollout and rollback

This task produces source and tests only. A later separately authorized
rollout must first inspect the authenticated pending queue, verify that a
deliverable row behind suppressed recoveries succeeds, and confirm benchmark
recovery webhook traffic remains zero while warning/critical/reminder traffic
still works.

No database action is required for rollback. If a verified broader delivery
regression occurs, revert only the exact source commit; prefer a forward fix
because reverting restores the known starvation and false-closure defects.

## Acceptance criteria

- Fifty or more old suppressed recovery rows cannot starve a later due
  deliverable.
- Suppressed rows remain pending without unsupported writes.
- Failed and stalled benchmark incidents close only on exact linked published
  success.
- A missing run date plus an exact dated bundle has one shared canonical ID and
  does not suppress a true official failure.
- The retry threshold has one owner.
- Unrelated alert delivery and recovery semantics remain unchanged.
