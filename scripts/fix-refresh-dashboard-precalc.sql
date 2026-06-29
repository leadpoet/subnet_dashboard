-- ============================================================
-- Fix: refresh_dashboard_precalc - remove miner_stats JSONB
--
-- Problem: miner_stats JSONB in dashboard_precalc exceeds 256MB limit
-- Fix: Write to dashboard_miner_stats rows directly instead
--
-- Run this entire script in the Supabase SQL Editor.
-- ============================================================

-- Step 0: Ensure hotkey has a unique constraint (needed for ON CONFLICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'dashboard_miner_stats' AND indexdef LIKE '%UNIQUE%hotkey%'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'dashboard_miner_stats'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE dashboard_miner_stats ADD CONSTRAINT dashboard_miner_stats_pkey PRIMARY KEY (hotkey);
  END IF;
END $$;

-- Step 1: Replace the function
CREATE OR REPLACE FUNCTION public.refresh_dashboard_precalc()
 RETURNS void
 LANGUAGE plpgsql
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  v_last_processed TIMESTAMPTZ;
  v_new_high_watermark TIMESTAMPTZ;
  v_start_time TIMESTAMPTZ;
  v_current_week_start DATE;
  v_latest_epoch INT;
BEGIN
  v_start_time := NOW();

  -- Increase timeout for safety
  SET LOCAL statement_timeout = '300s';

  -- Get last processed timestamp
  SELECT COALESCE(last_processed_ts, '1970-01-01'::timestamptz)
  INTO v_last_processed
  FROM dashboard_precalc WHERE id = 1;

  -- Get new high watermark (max ts we'll process this run)
  SELECT COALESCE(MAX(ts), v_last_processed)
  INTO v_new_high_watermark
  FROM transparency_log
  WHERE ts > v_last_processed;

  -- If no new data, just update timestamp and exit
  IF v_new_high_watermark <= v_last_processed THEN
    RAISE NOTICE 'No new data to process. Last processed: %', v_last_processed;
    UPDATE dashboard_precalc SET updated_at = NOW() WHERE id = 1;
    RETURN;
  END IF;

  RAISE NOTICE 'Processing records from % to %', v_last_processed, v_new_high_watermark;

  -- =============================================
  -- 1. Process new SUBMISSIONS (increment pending & miner totals)
  -- =============================================
  WITH new_submissions AS (
    SELECT
      actor_hotkey,
      email_hash,
      ts
    FROM transparency_log
    WHERE event_type = 'SUBMISSION'
      AND ts > v_last_processed
      AND ts <= v_new_high_watermark
      AND actor_hotkey IS NOT NULL
      AND email_hash IS NOT NULL
  )
  -- Update totals only (no miner_stats JSONB)
  UPDATE dashboard_precalc
  SET
    totals = jsonb_set(
      jsonb_set(
        totals,
        '{all_submissions}',
        to_jsonb(COALESCE((totals->>'all_submissions')::int, 0) + (SELECT COUNT(*) FROM new_submissions))
      ),
      '{all_pending}',
      to_jsonb(COALESCE((totals->>'all_pending')::int, 0) + (SELECT COUNT(*) FROM new_submissions))
    )
  WHERE id = 1;

  -- Update dashboard_miner_stats rows directly for new submissions
  INSERT INTO dashboard_miner_stats (hotkey, total, accepted, rejected, pending, acceptance_rate, avg_rep_score, epochs, rejection_reasons_raw, updated_at)
  SELECT
    actor_hotkey,
    new_total,
    0,
    0,
    new_total,
    0,
    0,
    '{}'::jsonb,
    '{}'::jsonb,
    NOW()
  FROM (
    SELECT actor_hotkey, COUNT(*) AS new_total
    FROM transparency_log
    WHERE event_type = 'SUBMISSION'
      AND ts > v_last_processed
      AND ts <= v_new_high_watermark
      AND actor_hotkey IS NOT NULL
      AND email_hash IS NOT NULL
    GROUP BY actor_hotkey
  ) msc
  ON CONFLICT (hotkey) DO UPDATE SET
    total = dashboard_miner_stats.total + EXCLUDED.total,
    pending = dashboard_miner_stats.pending + EXCLUDED.pending,
    updated_at = NOW();

  RAISE NOTICE 'Processed new submissions';

  -- =============================================
  -- 2. Process new CONSENSUS_RESULT (update decisions)
  -- =============================================
  WITH new_consensus AS (
    SELECT
      email_hash,
      payload->>'lead_id' AS lead_id,
      UPPER(payload->>'final_decision') AS decision,
      CASE
        WHEN payload->>'epoch_id' ~ '^\d+$'
        THEN (payload->>'epoch_id')::int
        ELSE NULL
      END AS epoch_id,
      CASE
        WHEN payload->>'final_rep_score' ~ '^-?\d+\.?\d*$'
        THEN GREATEST(0, (payload->>'final_rep_score')::float + COALESCE((payload->>'is_icp_multiplier')::float, 0))
        ELSE NULL
      END AS rep_score,
      payload->>'primary_rejection_reason' AS rejection_reason,
      DATE(ts) AS decision_date,
      ts
    FROM transparency_log
    WHERE event_type = 'CONSENSUS_RESULT'
      AND ts > v_last_processed
      AND ts <= v_new_high_watermark
      AND email_hash IS NOT NULL
  ),
  consensus_with_miner AS (
    SELECT
      nc.*,
      s.actor_hotkey
    FROM new_consensus nc
    LEFT JOIN LATERAL (
      SELECT actor_hotkey
      FROM transparency_log
      WHERE event_type = 'SUBMISSION'
        AND email_hash = nc.email_hash
        AND actor_hotkey IS NOT NULL
      ORDER BY ts DESC
      LIMIT 1
    ) s ON true
  ),
  categorized AS (
    SELECT
      *,
      CASE
        WHEN decision IN ('ALLOW', 'ALLOWED', 'ACCEPT', 'ACCEPTED', 'APPROVE', 'APPROVED') THEN 'ACCEPTED'
        WHEN decision IN ('DENY', 'DENIED', 'REJECT', 'REJECTED') THEN 'REJECTED'
        ELSE 'OTHER'
      END AS decision_category
    FROM consensus_with_miner
    WHERE decision IS NOT NULL
  ),
  -- Aggregate by epoch (global)
  epoch_consensus_stats AS (
    SELECT
      epoch_id,
      COUNT(*) AS new_total,
      COUNT(*) FILTER (WHERE decision_category = 'ACCEPTED') AS new_accepted,
      COUNT(*) FILTER (WHERE decision_category = 'REJECTED') AS new_rejected,
      AVG(rep_score) FILTER (WHERE decision_category = 'ACCEPTED') AS avg_new_rep_score
    FROM categorized
    WHERE epoch_id IS NOT NULL
    GROUP BY epoch_id
  ),
  -- Aggregate for totals
  total_consensus_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE decision_category = 'ACCEPTED') AS new_accepted,
      COUNT(*) FILTER (WHERE decision_category = 'REJECTED') AS new_rejected,
      MAX(epoch_id) AS max_epoch
    FROM categorized
  ),
  -- Daily lead counts for lead_inventory
  daily_accepted AS (
    SELECT
      decision_date,
      COUNT(*) AS new_leads
    FROM categorized
    WHERE decision_category = 'ACCEPTED'
    GROUP BY decision_date
  )
  -- Update dashboard_precalc WITHOUT miner_stats
  UPDATE dashboard_precalc
  SET
    -- Update epoch_stats
    epoch_stats = (
      SELECT COALESCE(
        (SELECT epoch_stats FROM dashboard_precalc WHERE id = 1) ||
        (
          SELECT COALESCE(jsonb_object_agg(
            epoch_id::text,
            jsonb_build_object(
              'total', COALESCE((existing->>'total')::int, 0) + ecs.new_total,
              'accepted', COALESCE((existing->>'accepted')::int, 0) + ecs.new_accepted,
              'rejected', COALESCE((existing->>'rejected')::int, 0) + ecs.new_rejected,
              'acceptance_rate', ROUND(
                ((COALESCE((existing->>'accepted')::int, 0) + ecs.new_accepted)::numeric /
                NULLIF(COALESCE((existing->>'accepted')::int, 0) + ecs.new_accepted +
                       COALESCE((existing->>'rejected')::int, 0) + ecs.new_rejected, 0)) * 100,
                1
              ),
              'avg_rep_score', ROUND(
                (CASE
                  WHEN COALESCE((existing->>'accepted')::int, 0) + ecs.new_accepted = 0 THEN 0
                  ELSE (
                    COALESCE((existing->>'avg_rep_score')::numeric, 0) * COALESCE((existing->>'accepted')::int, 0) +
                    COALESCE(ecs.avg_new_rep_score::numeric, 0) * ecs.new_accepted
                  ) / (COALESCE((existing->>'accepted')::int, 0) + ecs.new_accepted)
                END)::numeric,
                4
              )
            )
          ), '{}'::jsonb)
          FROM epoch_consensus_stats ecs
          LEFT JOIN jsonb_each((SELECT epoch_stats FROM dashboard_precalc WHERE id = 1)) AS e(key, existing)
            ON ecs.epoch_id::text = e.key
        ),
        '{}'::jsonb
      )
    ),
    -- Update totals
    totals = (
      SELECT jsonb_build_object(
        'all_submissions', COALESCE((totals->>'all_submissions')::int, 0),
        'all_accepted', COALESCE((totals->>'all_accepted')::int, 0) + COALESCE(tcs.new_accepted, 0),
        'all_rejected', COALESCE((totals->>'all_rejected')::int, 0) + COALESCE(tcs.new_rejected, 0),
        'all_pending', GREATEST(0, COALESCE((totals->>'all_pending')::int, 0) - COALESCE(tcs.new_accepted, 0) - COALESCE(tcs.new_rejected, 0)),
        'deleted_pending', COALESCE((totals->>'deleted_pending')::int, 0),
        'unique_miners', COALESCE((totals->>'unique_miners')::int, 0),
        'unique_epochs', COALESCE((totals->>'unique_epochs')::int, 0),
        'latest_epoch', GREATEST(COALESCE((totals->>'latest_epoch')::int, 0), COALESCE(tcs.max_epoch, 0))
      )
      FROM total_consensus_stats tcs
    ),
    -- Update lead_inventory
    lead_inventory = (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'date', date,
            'new_leads', new_leads,
            'cumulative', cumulative
          )
          ORDER BY date DESC
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT
          date,
          new_leads,
          SUM(new_leads) OVER (ORDER BY date) AS cumulative
        FROM (
          SELECT
            COALESCE(e.date, n.decision_date) AS date,
            COALESCE((e.entry->>'new_leads')::int, 0) + COALESCE(n.new_leads, 0) AS new_leads
          FROM (
            SELECT (entry->>'date')::date AS date, entry
            FROM jsonb_array_elements((SELECT lead_inventory FROM dashboard_precalc WHERE id = 1)) AS entry
          ) e
          FULL OUTER JOIN daily_accepted n ON e.date = n.decision_date
          WHERE COALESCE(e.date, n.decision_date) IS NOT NULL
        ) merged
      ) with_cumulative
    )
  WHERE id = 1;

  -- Update dashboard_miner_stats rows directly for consensus results
  -- This replaces the miner_stats JSONB + trigger approach
  WITH new_consensus AS (
    SELECT
      email_hash,
      UPPER(payload->>'final_decision') AS decision,
      CASE
        WHEN payload->>'epoch_id' ~ '^\d+$'
        THEN (payload->>'epoch_id')::int
        ELSE NULL
      END AS epoch_id,
      CASE
        WHEN payload->>'final_rep_score' ~ '^-?\d+\.?\d*$'
        THEN GREATEST(0, (payload->>'final_rep_score')::float + COALESCE((payload->>'is_icp_multiplier')::float, 0))
        ELSE NULL
      END AS rep_score,
      payload->>'primary_rejection_reason' AS rejection_reason,
      ts
    FROM transparency_log
    WHERE event_type = 'CONSENSUS_RESULT'
      AND ts > v_last_processed
      AND ts <= v_new_high_watermark
      AND email_hash IS NOT NULL
  ),
  consensus_with_miner2 AS (
    SELECT
      nc.*,
      s.actor_hotkey
    FROM new_consensus nc
    LEFT JOIN LATERAL (
      SELECT actor_hotkey
      FROM transparency_log
      WHERE event_type = 'SUBMISSION'
        AND email_hash = nc.email_hash
        AND actor_hotkey IS NOT NULL
      ORDER BY ts DESC
      LIMIT 1
    ) s ON true
  ),
  categorized2 AS (
    SELECT
      *,
      CASE
        WHEN decision IN ('ALLOW', 'ALLOWED', 'ACCEPT', 'ACCEPTED', 'APPROVE', 'APPROVED') THEN 'ACCEPTED'
        WHEN decision IN ('DENY', 'DENIED', 'REJECT', 'REJECTED') THEN 'REJECTED'
        ELSE 'OTHER'
      END AS decision_category
    FROM consensus_with_miner2
    WHERE decision IS NOT NULL
  ),
  miner_consensus_stats2 AS (
    SELECT
      actor_hotkey,
      COUNT(*) FILTER (WHERE decision_category = 'ACCEPTED') AS new_accepted,
      COUNT(*) FILTER (WHERE decision_category = 'REJECTED') AS new_rejected,
      AVG(rep_score) FILTER (WHERE decision_category = 'ACCEPTED') AS avg_new_rep_score
    FROM categorized2
    WHERE actor_hotkey IS NOT NULL
    GROUP BY actor_hotkey
  ),
  miner_epoch_stats2 AS (
    SELECT
      actor_hotkey,
      epoch_id,
      COUNT(*) FILTER (WHERE decision_category = 'ACCEPTED') AS new_accepted,
      COUNT(*) FILTER (WHERE decision_category = 'REJECTED') AS new_rejected
    FROM categorized2
    WHERE actor_hotkey IS NOT NULL AND epoch_id IS NOT NULL
    GROUP BY actor_hotkey, epoch_id
  ),
  miner_rejection_stats2 AS (
    SELECT
      actor_hotkey,
      rejection_reason,
      COUNT(*) AS reason_count
    FROM categorized2
    WHERE actor_hotkey IS NOT NULL
      AND decision_category = 'REJECTED'
      AND rejection_reason IS NOT NULL
    GROUP BY actor_hotkey, rejection_reason
  ),
  miner_epoch_jsonb2 AS (
    SELECT
      actor_hotkey,
      jsonb_object_agg(
        epoch_id::text,
        jsonb_build_object('accepted', new_accepted, 'rejected', new_rejected)
      ) AS new_epochs
    FROM miner_epoch_stats2
    GROUP BY actor_hotkey
  ),
  miner_rejection_jsonb2 AS (
    SELECT
      actor_hotkey,
      jsonb_object_agg(rejection_reason, reason_count) AS new_reasons
    FROM miner_rejection_stats2
    GROUP BY actor_hotkey
  ),
  miner_updates AS (
    SELECT
      mcs.actor_hotkey,
      mcs.new_accepted,
      mcs.new_rejected,
      mcs.avg_new_rep_score,
      COALESCE(mej.new_epochs, '{}'::jsonb) AS new_epochs,
      COALESCE(mrj.new_reasons, '{}'::jsonb) AS new_reasons
    FROM miner_consensus_stats2 mcs
    LEFT JOIN miner_epoch_jsonb2 mej ON mcs.actor_hotkey = mej.actor_hotkey
    LEFT JOIN miner_rejection_jsonb2 mrj ON mcs.actor_hotkey = mrj.actor_hotkey
  )
  UPDATE dashboard_miner_stats dms
  SET
    accepted = dms.accepted + mu.new_accepted,
    rejected = dms.rejected + mu.new_rejected,
    pending = GREATEST(0, dms.pending - mu.new_accepted - mu.new_rejected),
    acceptance_rate = ROUND(
      ((dms.accepted + mu.new_accepted)::numeric /
      NULLIF(dms.accepted + mu.new_accepted + dms.rejected + mu.new_rejected, 0)) * 100,
      1
    ),
    avg_rep_score = ROUND(
      (CASE
        WHEN dms.accepted + mu.new_accepted = 0 THEN 0
        ELSE (
          dms.avg_rep_score * dms.accepted +
          COALESCE(mu.avg_new_rep_score, 0) * mu.new_accepted
        ) / (dms.accepted + mu.new_accepted)
      END)::numeric,
      4
    ),
    epochs = merge_epoch_jsonb(dms.epochs, mu.new_epochs),
    rejection_reasons_raw = merge_reasons_jsonb(dms.rejection_reasons_raw, mu.new_reasons),
    updated_at = NOW()
  FROM miner_updates mu
  WHERE dms.hotkey = mu.actor_hotkey;

  RAISE NOTICE 'Processed consensus results';

  -- =============================================
  -- 2b. Update epoch_rejection_reasons
  -- =============================================

  SELECT COALESCE((totals->>'latest_epoch')::int, 0)
  INTO v_latest_epoch
  FROM dashboard_precalc WHERE id = 1;

  WITH new_epoch_reasons AS (
    SELECT
      (payload->>'epoch_id') AS epoch_key,
      payload->>'primary_rejection_reason' AS reason,
      COUNT(*) AS cnt
    FROM transparency_log
    WHERE event_type = 'CONSENSUS_RESULT'
      AND ts > v_last_processed
      AND ts <= v_new_high_watermark
      AND payload->>'final_decision' IN ('DENY', 'deny', 'REJECTED', 'rejected')
      AND payload->>'primary_rejection_reason' IS NOT NULL
      AND payload->>'epoch_id' IS NOT NULL
      AND payload->>'epoch_id' ~ '^\d+$'
    GROUP BY epoch_key, reason
  ),
  new_epoch_agg AS (
    SELECT
      epoch_key,
      jsonb_object_agg(reason, cnt) AS reasons
    FROM new_epoch_reasons
    GROUP BY epoch_key
  ),
  existing_reasons AS (
    SELECT key AS epoch_key, value AS reasons
    FROM jsonb_each((SELECT COALESCE(epoch_rejection_reasons, '{}'::jsonb) FROM dashboard_precalc WHERE id = 1))
  ),
  merged_reasons AS (
    SELECT
      COALESCE(e.epoch_key, n.epoch_key) AS epoch_key,
      CASE
        WHEN e.epoch_key IS NULL THEN n.reasons
        WHEN n.epoch_key IS NULL THEN e.reasons
        ELSE merge_reasons_jsonb(e.reasons, n.reasons)
      END AS reasons
    FROM existing_reasons e
    FULL OUTER JOIN new_epoch_agg n ON e.epoch_key = n.epoch_key
  ),
  pruned_reasons AS (
    SELECT jsonb_object_agg(epoch_key, reasons) AS final_reasons
    FROM (
      SELECT epoch_key, reasons
      FROM merged_reasons
      WHERE epoch_key ~ '^\d+$'
        AND epoch_key::int > (v_latest_epoch - 150)
      ORDER BY epoch_key::int DESC
    ) top_epochs
  )
  UPDATE dashboard_precalc
  SET epoch_rejection_reasons = COALESCE((SELECT final_reasons FROM pruned_reasons), '{}'::jsonb)
  WHERE id = 1;

  RAISE NOTICE 'Updated epoch_rejection_reasons';

  -- =============================================
  -- 3. Recalculate weekly_lead_inventory from lead_inventory
  -- =============================================
  v_current_week_start := CURRENT_DATE - ((EXTRACT(DOW FROM CURRENT_DATE)::int + 2) % 7);

  UPDATE dashboard_precalc
  SET weekly_lead_inventory = (
    WITH daily_data AS (
      SELECT
        (entry->>'date')::date AS date,
        (entry->>'new_leads')::int AS new_leads
      FROM jsonb_array_elements(lead_inventory) AS entry
      WHERE (entry->>'date')::date >= CURRENT_DATE - INTERVAL '8 weeks'
    ),
    weekly_data AS (
      SELECT
        (date - ((EXTRACT(DOW FROM date)::int + 2) % 7))::date AS week_start,
        SUM(new_leads) AS leads_added
      FROM daily_data
      GROUP BY (date - ((EXTRACT(DOW FROM date)::int + 2) % 7))::date
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'week_start', week_start,
          'period_end', CASE
            WHEN week_start = v_current_week_start THEN CURRENT_DATE
            ELSE week_start + 6
          END,
          'is_complete', week_start < v_current_week_start,
          'leads_added', leads_added
        )
        ORDER BY week_start DESC
      ),
      '[]'::jsonb
    )
    FROM weekly_data
    LIMIT 8
  )
  WHERE id = 1;

  -- =============================================
  -- 4. Update timestamps
  -- =============================================
  UPDATE dashboard_precalc
  SET
    last_processed_ts = v_new_high_watermark,
    updated_at = NOW()
  WHERE id = 1;

  RAISE NOTICE 'Incremental refresh completed in % seconds. Processed up to %',
    EXTRACT(EPOCH FROM (NOW() - v_start_time)),
    v_new_high_watermark;

END;
$function$;

-- Step 2: Drop the trigger (no longer needed - we write rows directly)
DROP TRIGGER IF EXISTS trigger_sync_miner_stats ON dashboard_precalc;

-- Step 3: NULL out the bloated miner_stats JSONB to reclaim ~256MB
UPDATE dashboard_precalc SET miner_stats = NULL WHERE id = 1;

-- Step 4: Run the function to catch up on missed data (extra timeout for backlog)
SET statement_timeout = '600s';
SELECT refresh_dashboard_precalc();
RESET statement_timeout;

-- Step 5: Verify
SELECT updated_at FROM dashboard_precalc WHERE id = 1;
SELECT count(*), max(updated_at) FROM dashboard_miner_stats;
