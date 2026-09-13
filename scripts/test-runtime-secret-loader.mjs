import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

// The dashboard runtime already supplies AWS in production. Keep this test
// runnable in the small checkout used by CI and local audits, where the AWS
// SDK is intentionally not installed, by loading the pure validation helpers
// without executing the AWS client import.
const loaderSource = await readFile(new URL('./load-runtime-secret.mjs', import.meta.url), 'utf8')
const pureLoader = loaderSource
  .replace("import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'\n", '')
  .replace("import { pathToFileURL } from 'node:url'\n", '')
  .replace(/async function main\(\) \{[\s\S]*$/u, '')
const loader = await import(`data:text/javascript;base64,${Buffer.from(pureLoader).toString('base64')}`)
const { OPTIONAL_RUNTIME_SECRET_KEYS, REQUIRED_RUNTIME_SECRET_KEYS, RUNTIME_SECRET_KEYS, formatShellEnvironment, parseRuntimeSecret } = loader

const document = Object.fromEntries(
  RUNTIME_SECRET_KEYS.map((key, index) => [key, `value-${index}`]),
)
document.ADMIN_PASS = "spaces $dollar 'quote'\nand newline"

const parsed = parseRuntimeSecret(JSON.stringify({ ...document, IGNORED_EXTRA_KEY: 'not-exported' }))
assert.deepEqual(parsed, document)

const requiredOnly = Object.fromEntries(
  REQUIRED_RUNTIME_SECRET_KEYS.map((key, index) => [key, `required-${index}`]),
)
assert.deepEqual(
  parseRuntimeSecret(JSON.stringify(requiredOnly)),
  requiredOnly,
  'all dashboard runtime secrets are required',
)
assert.equal(OPTIONAL_RUNTIME_SECRET_KEYS.length, 0)

const shell = formatShellEnvironment(parsed)
assert.match(shell, /^ADMIN_USER='value-0'$/m)
assert.match(shell, /ADMIN_PASS='spaces \$dollar '\"'\"'quote'\"'\"'\nand newline'/)
assert.doesNotMatch(shell, /IGNORED_EXTRA_KEY/)
assert.equal(shell.trimEnd().split('\n').filter((line) => /^[A-Z0-9_]+=/.test(line)).length, RUNTIME_SECRET_KEYS.length)

assert.throws(
  () => parseRuntimeSecret(JSON.stringify({ ...document, ADMIN_SESSION_SECRET: '' })),
  /missing non-empty ADMIN_SESSION_SECRET/,
)
assert.throws(
  () => parseRuntimeSecret(JSON.stringify({ ...document, ADMIN_USER: ' admin' })),
  /ADMIN_USER has leading or trailing whitespace/,
)
assert.throws(() => parseRuntimeSecret('not-json'), /not valid JSON/)

const launcher = await readFile(new URL('./start-production.mjs', import.meta.url), 'utf8')
assert.match(launcher, /const values = await loadSecrets\(\{ env \}\)/)
assert.match(launcher, /for \(const key of RUNTIME_SECRET_KEYS\)/)
assert.match(launcher, /typeof values\[key\] === 'string'/)
assert.match(launcher, /else delete env\[key\]/)
assert.match(launcher, /globalThis\.__leadpoetSubnetDashboardRuntimeSecretsV1 = values/)
assert.match(launcher, /await runNext\(\)/)
assert.match(launcher, /startProduction\(\)\.catch/)
assert.doesNotMatch(launcher, /if \(process\.argv\[1\]/)

const require = createRequire(import.meta.url)
const ecosystem = require('../ecosystem.config.cjs')
for (const key of RUNTIME_SECRET_KEYS) assert.ok(ecosystem.apps[0].filter_env.includes(key))
for (const key of ['SUPABASE_SECRET_KEY', 'OPENROUTER_KEY', 'RESEARCH_LAB_ALERT_DISCORD_WEBHOOK_URL']) {
  assert.ok(ecosystem.apps[0].filter_env.includes(key), `${key} must be scrubbed from stale PM2 metadata`)
}
assert.match(ecosystem.apps[0].script, /scripts\/start-production\.mjs$/)
assert.equal(ecosystem.apps[0].env.NODE_ENV, 'production')

const deployment = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
assert.match(deployment, /Correcting stale slot pointer/)
assert.doesNotMatch(deployment, /verify-runtime-monitors|RESEARCH_LAB_ALERT_MONITOR/)

const runtimeSecretEnvironment = await readFile(
  new URL('../src/lib/runtime-secret-environment.ts', import.meta.url),
  'utf8',
)
assert.match(runtimeSecretEnvironment, /runtimeSecretStore\(\)\?\.\[name\] \?\? process\.env\[name\]/)
assert.match(runtimeSecretEnvironment, /installRuntimeSecretEnvironment/)

const instrumentation = await readFile(new URL('../src/instrumentation.ts', import.meta.url), 'utf8')
assert.match(instrumentation, /import\('\.\.\/scripts\/load-runtime-secret\.mjs'\)/)
assert.match(instrumentation, /await loadRuntimeSecretValues\(\)/)
assert.match(instrumentation, /installRuntimeSecretEnvironment\(runtimeSecretValues\)/)

console.log('runtime-secret-loader: strict allowlist, validation, and shell escaping passed')
