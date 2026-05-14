import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_GATEWAY_URL = 'http://52.91.135.79:8000'

type FulfillmentPayload = {
  prompt?: unknown
  industry?: unknown
  sub_industry?: unknown
  target_roles?: unknown
  target_role_types?: unknown
  target_seniority?: unknown
  employee_count?: unknown
  country?: unknown
  geography?: unknown
  intent_signals?: unknown
  product_service?: unknown
  num_leads?: unknown
  internal_label?: unknown
  company?: unknown
  excluded_companies?: unknown
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function validatePayload(body: FulfillmentPayload): string[] {
  const errors: string[] = []

  const requiredStrings: Array<keyof FulfillmentPayload> = [
    'prompt',
    'product_service',
    'internal_label',
    'company',
  ]
  for (const key of requiredStrings) {
    if (!isNonEmptyString(body[key])) errors.push(`${key} is required`)
  }

  const optionalArrays: Array<keyof FulfillmentPayload> = [
    'industry',
    'sub_industry',
    'target_roles',
    'target_role_types',
    'employee_count',
    'country',
    'intent_signals',
  ]
  for (const key of optionalArrays) {
    if (body[key] !== undefined && !isStringArray(body[key])) {
      errors.push(`${key} must be a list`)
    }
  }

  if (!Number.isInteger(body.num_leads) || Number(body.num_leads) <= 0) {
    errors.push('num_leads must be a positive integer')
  }

  if (body.excluded_companies !== undefined && !isStringArray(body.excluded_companies)) {
    errors.push('excluded_companies must be a list')
  }

  return errors
}

export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY
  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: 'SUPABASE_SECRET_KEY is not configured on the server.' },
      { status: 503 },
    )
  }

  let body: FulfillmentPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const validationErrors = validatePayload(body)
  if (validationErrors.length > 0) {
    return NextResponse.json({ error: 'Invalid request payload.', details: validationErrors }, { status: 400 })
  }

  const gatewayBase = (process.env.FULFILLMENT_GATEWAY_URL ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, '')
  const gatewayUrl = `${gatewayBase}/fulfillment/request`

  try {
    const gatewayRes = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const text = await gatewayRes.text()
    let payload: unknown = text
    try {
      payload = JSON.parse(text)
    } catch {
      // Keep raw response text when gateway returns non-JSON.
    }

    if (!gatewayRes.ok) {
      return NextResponse.json(
        {
          error: 'Gateway rejected the fulfillment request.',
          status: gatewayRes.status,
          details: payload,
        },
        { status: gatewayRes.status },
      )
    }

    return NextResponse.json(
      {
        success: true,
        gateway: payload,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to reach fulfillment gateway.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    )
  }
}
