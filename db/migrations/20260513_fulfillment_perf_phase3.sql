-- ============================================================
-- Fulfillment performance, Phase 3.
--
-- This migration introduces two pre-aggregated tables that let the
-- API serve the cosmos and the leaderboard without scanning the
-- entire `fulfillment_score_consensus` table on every request.
--
-- Apply via the Supabase SQL editor or `psql`. Both tables are
-- refreshed by triggers + a periodic cron, defined at the bottom.
--
-- Safe to run in production. All objects are CREATE-IF-NOT-EXISTS
-- where possible, and the materialized views can be refreshed
-- without locking reads (CONCURRENTLY).
--
-- Rollback: drop the cron jobs, drop the views, drop the table.
-- The API code falls back to the in-route aggregations if these
-- objects don't exist (see route.ts comments).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Leaderboard materialized view.
--    Pre-aggregated wins-per-miner over the last 30 days,
--    excluding banned hotkeys. Refreshed every minute by a cron
--    job (see bottom). Reads are O(distinct miners), not
--    O(total wins ever).
-- ------------------------------------------------------------

CREATE MATERIALIZED VIEW IF NOT EXISTS fulfillment_leaderboard_30d AS
SELECT
  c.miner_hotkey,
  COUNT(*)::int                                AS wins,
  COALESCE(SUM(c.reward_pct), 0)::numeric(12,4) AS total_reward_pct,
  MAX(c.computed_at)                           AS last_win_at
FROM fulfillment_score_consensus c
WHERE c.is_winner = true
  AND c.computed_at >= NOW() - INTERVAL '30 days'
  AND NOT EXISTS (
    SELECT 1 FROM banned_hotkeys b WHERE b.hotkey = c.miner_hotkey
  )
GROUP BY c.miner_hotkey;

-- Required for CONCURRENT refresh.
CREATE UNIQUE INDEX IF NOT EXISTS fulfillment_leaderboard_30d_pk
  ON fulfillment_leaderboard_30d (miner_hotkey);

-- Top-K read path uses (wins DESC, total_reward_pct DESC).
CREATE INDEX IF NOT EXISTS fulfillment_leaderboard_30d_rank
  ON fulfillment_leaderboard_30d (wins DESC, total_reward_pct DESC);


-- ------------------------------------------------------------
-- 2. Cosmos snapshot table.
--    One row per (request_id, miner_hotkey) pair with aggregated
--    lead and win counts. The cosmos consumes this instead of the
--    raw consensus rows, dropping wire payload by ~95% and making
--    payload size proportional to graph complexity (~R*M edges in
--    practice, sparse) rather than total lead history.
--
--    Refreshed by an AFTER INSERT/UPDATE trigger on
--    fulfillment_score_consensus, plus a defensive periodic
--    refresh for any rows missed by the trigger.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fulfillment_cosmos_snapshot (
  request_id  text NOT NULL,
  miner_hotkey text NOT NULL,
  lead_count  integer NOT NULL DEFAULT 0,
  win_count   integer NOT NULL DEFAULT 0,
  last_lead_at timestamptz,
  PRIMARY KEY (request_id, miner_hotkey)
);

CREATE INDEX IF NOT EXISTS fulfillment_cosmos_snapshot_request
  ON fulfillment_cosmos_snapshot (request_id);
CREATE INDEX IF NOT EXISTS fulfillment_cosmos_snapshot_miner
  ON fulfillment_cosmos_snapshot (miner_hotkey);


-- Trigger function: keep the snapshot in sync with consensus rows.
CREATE OR REPLACE FUNCTION refresh_cosmos_snapshot_row()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO fulfillment_cosmos_snapshot (request_id, miner_hotkey, lead_count, win_count, last_lead_at)
  VALUES (
    NEW.request_id,
    NEW.miner_hotkey,
    1,
    CASE WHEN NEW.is_winner THEN 1 ELSE 0 END,
    COALESCE(NEW.computed_at, NOW())
  )
  ON CONFLICT (request_id, miner_hotkey) DO UPDATE
  SET lead_count   = fulfillment_cosmos_snapshot.lead_count + 1,
      win_count    = fulfillment_cosmos_snapshot.win_count + CASE WHEN NEW.is_winner THEN 1 ELSE 0 END,
      last_lead_at = GREATEST(fulfillment_cosmos_snapshot.last_lead_at, COALESCE(NEW.computed_at, NOW()));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cosmos_snapshot_insert ON fulfillment_score_consensus;
CREATE TRIGGER trg_cosmos_snapshot_insert
  AFTER INSERT ON fulfillment_score_consensus
  FOR EACH ROW
  EXECUTE FUNCTION refresh_cosmos_snapshot_row();

-- Note: UPDATE handling intentionally omitted for v1. If is_winner
-- can flip after insert (chain-canonical override later), add an
-- AFTER UPDATE trigger that recomputes win_count for the affected
-- (request_id, miner_hotkey) pair.


-- ------------------------------------------------------------
-- 3. Defensive periodic refreshes.
--    Re-aggregate from scratch every minute in case trigger races
--    or backfills leave the snapshots stale.
--
--    Requires the pg_cron extension. If your Supabase project
--    doesn't have it enabled, run from the Supabase dashboard:
--      "Database > Extensions > pg_cron > enable"
-- ------------------------------------------------------------

-- Leaderboard refresh (CONCURRENTLY = no read locking).
SELECT cron.schedule(
  'fulfillment-leaderboard-refresh',
  '* * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY fulfillment_leaderboard_30d;$$
);

-- Cosmos snapshot full rebuild (cheap because it's an aggregate
-- of a bounded set of requests; the trigger keeps it warm between
-- rebuilds).
SELECT cron.schedule(
  'fulfillment-cosmos-snapshot-refresh',
  '* * * * *',
  $$
  TRUNCATE fulfillment_cosmos_snapshot;
  INSERT INTO fulfillment_cosmos_snapshot (request_id, miner_hotkey, lead_count, win_count, last_lead_at)
  SELECT
    request_id,
    miner_hotkey,
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE is_winner)::int,
    MAX(computed_at)
  FROM fulfillment_score_consensus
  GROUP BY request_id, miner_hotkey;
  $$
);

-- ============================================================
-- END OF MIGRATION
-- ============================================================
