import path from 'node:path'
import { pathToFileURL } from 'node:url'

const appRoot = process.env.SUBNET_DASHBOARD_APP_ROOT?.trim() || process.cwd()
const secretLoaderUrl = pathToFileURL(path.join(appRoot, 'scripts/load-runtime-secret.mjs')).href
const { loadRuntimeSecretValues } = await import(secretLoaderUrl)

const values = await loadRuntimeSecretValues()
const testId = process.env.RESEARCH_LAB_DISCORD_TEST_ID?.trim() || new Date().toISOString()
const endpoints = [
  {
    label: 'bug_watch',
    username: 'Leadpoet Bug Watch',
    url: values.RESEARCH_LAB_ALERT_DISCORD_WEBHOOK_URL,
  },
  {
    label: 'lab_chat',
    username: 'Leadpoet Lab Watch',
    url: values.RESEARCH_LAB_IMPROVEMENT_DISCORD_WEBHOOK_URL,
  },
]

const results = []
for (const endpoint of endpoints) {
  const url = new URL(endpoint.url)
  if (
    url.protocol !== 'https:'
    || !['discord.com', 'discordapp.com'].includes(url.hostname)
    || !/^\/api(?:\/v\d+)?\/webhooks\/[^/]+\/[^/]+\/?$/.test(url.pathname)
  ) {
    throw new Error(`${endpoint.label} is not a supported Discord webhook URL.`)
  }

  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: endpoint.username,
      content: [
        '**TEST ONLY — no incident is open.**',
        `Manual webhook verification for **${endpoint.label}**.`,
        `Test ID: \`${testId}\``,
      ].join('\n'),
      allowed_mentions: { parse: [] },
    }),
    signal: AbortSignal.timeout(15_000),
  })

  results.push({
    endpoint: endpoint.label,
    ok: response.ok,
    status: response.status,
  })
}

process.stdout.write(`${JSON.stringify({ ok: results.every((result) => result.ok), results })}\n`)
if (results.some((result) => !result.ok)) process.exitCode = 1
