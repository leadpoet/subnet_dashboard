import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

export interface TransparencyLogEvent {
  id: string
  ts: string
  event_type: string
  actor_hotkey: string | null
  email_hash: string | null
  tee_sequence: number | null
  payload: EventPayload
}

export interface EventPayload {
  lead_id?: string
  lead_blob_hash?: string
  miner_hotkey?: string
  uid?: number
  epoch_id?: number
  final_decision?: string
  final_rep_score?: number
  primary_rejection_reason?: string
  validator_count?: number
  consensus_weight?: number
  mirror?: string
  verified?: boolean
  hash_match?: boolean
}

export async function fetchLeadJourney(
  emailHash: string,
  leadId?: string | null,
): Promise<TransparencyLogEvent[]> {
  void emailHash
  void leadId
  return []
}
