-- Egress reduction: batch the three per-request chain RPCs into one call.
--
-- The fulfillment dashboard API called get_chain_winners, get_chain_root_num_leads
-- and get_chain_held_count once PER active request id (N requests -> 3xN RPCs),
-- and each re-walked the same recursive fulfillment_requests chain. That fan-out
-- is the dominant weekly PostgREST volume (the ~5.46M get_chain_* calls).
--
-- get_chain_summaries takes the full array of request ids, walks each chain ONCE,
-- and returns, per id: the full chain-canonical WINNER rows (so the caller no
-- longer needs a supplemental `lead_id IN (...)` query), plus root num_leads and
-- held_count. Verified row-for-row against live data.
--
-- Safety (this RPC is anon-callable):
--   * input is bounded to 100 unique request ids;
--   * the recursion uses UNION (not UNION ALL) so a cyclic successor chain
--     terminates instead of looping forever.

CREATE OR REPLACE FUNCTION public.get_chain_summaries(p_request_ids uuid[])
RETURNS TABLE(
    request_id     uuid,
    winners        jsonb,
    root_num_leads integer,
    held_count     integer
)
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
    IF p_request_ids IS NULL THEN
        RETURN;
    END IF;
    -- Bound the RAW array BEFORE any unnest: a huge array full of duplicates
    -- must not be scanned just to count its distinct members.
    IF cardinality(p_request_ids) > 100 THEN
        RAISE EXCEPTION 'get_chain_summaries accepts at most 100 request ids'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH RECURSIVE input(root_id) AS (
        SELECT DISTINCT unnest(p_request_ids)
    ),
    -- Walk each root's chain once, carrying the root id. UNION (not UNION ALL)
    -- dedups, so a cyclic successor_request_id chain terminates; for the real
    -- acyclic data the member set is identical to the deployed functions.
    chain AS (
        SELECT i.root_id, fr.request_id, fr.num_leads
        FROM input i
        JOIN public.fulfillment_requests fr ON fr.request_id = i.root_id
        UNION
        SELECT c.root_id, fr.request_id, fr.num_leads
        FROM public.fulfillment_requests fr
        JOIN chain c ON fr.successor_request_id = c.request_id
    )
    SELECT
        i.root_id AS request_id,
        -- Full winner rows (score-desc), only the columns the response mapper
        -- reads. Returning these means no separate lead_id IN (...) query.
        COALESCE((
            SELECT jsonb_agg(to_jsonb(w) ORDER BY w.consensus_final_score DESC NULLS LAST)
            FROM (
                SELECT fsc.consensus_id, fsc.request_id, fsc.miner_hotkey, fsc.lead_id,
                       fsc.consensus_final_score, fsc.consensus_rep_score, fsc.any_fabricated,
                       fsc.is_winner, fsc.reward_pct, fsc.computed_at,
                       fsc.consensus_email_verified, fsc.consensus_person_verified,
                       fsc.consensus_company_verified
                FROM public.fulfillment_score_consensus fsc
                JOIN chain c ON fsc.request_id = c.request_id
                WHERE c.root_id = i.root_id AND fsc.is_winner = true
            ) w
        ), '[]'::jsonb) AS winners,
        (SELECT MAX(c.num_leads) FROM chain c WHERE c.root_id = i.root_id) AS root_num_leads,
        (SELECT count(*)::int
           FROM public.fulfillment_score_consensus fsc
           JOIN chain c ON fsc.request_id = c.request_id
           WHERE c.root_id = i.root_id AND fsc.is_chain_held = true) AS held_count
    FROM input i;
END;
$function$;

-- Match the grants on the existing get_chain_* functions.
GRANT EXECUTE ON FUNCTION public.get_chain_summaries(uuid[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chain_summaries(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.get_chain_summaries(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_chain_summaries(uuid[]) TO service_role;
