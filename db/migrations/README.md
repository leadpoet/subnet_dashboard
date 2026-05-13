# Database migrations

SQL migrations that need to be applied to the Supabase project manually.

## Applying a migration

1. Open the Supabase dashboard for the project.
2. Go to **SQL Editor**.
3. Open the migration file from this folder.
4. Paste the entire contents into the editor.
5. Run.

All migrations in this folder are idempotent (`CREATE … IF NOT EXISTS`, `DROP TRIGGER IF EXISTS … CREATE TRIGGER`, etc.) so re-running a migration on a project where it has already been applied is safe.

## Naming convention

`YYYYMMDD_<short_topic>.sql`, e.g. `20260513_fulfillment_perf_phase3.sql`.

## Pending migrations

| File | What it does | Status |
|------|-------------|--------|
| `20260513_fulfillment_perf_phase3.sql` | Materialized leaderboard view + cosmos snapshot table for sub-100ms aggregate reads at any scale. | **Not yet applied.** Apply when fulfillment_score_consensus crosses ~50k rows. |

## When to apply 20260513

The API route already gracefully handles the absence of these tables. Apply when:
- The leaderboard query in `api/fulfillment/route.ts` starts running >500ms in production.
- Or when `fulfillment_score_consensus` has more than ~50,000 winning rows over a 30-day window.

After applying, you can also delete the in-route leaderboard aggregation and replace it with a direct `SELECT … FROM fulfillment_leaderboard_30d ORDER BY wins DESC, total_reward_pct DESC LIMIT 5` for an even tighter read path.
