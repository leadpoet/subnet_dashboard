import { RUNTIME_SECRET_KEYS, loadRuntimeSecretValues } from './load-runtime-secret.mjs'

export async function startProduction({
  env = process.env,
  loadSecrets = loadRuntimeSecretValues,
  runNext = () => import('next/dist/bin/next'),
  log = console.error,
} = {}) {
  const values = await loadSecrets({ env })
  for (const key of RUNTIME_SECRET_KEYS) env[key] = values[key]
  globalThis.__leadpoetSubnetDashboardRuntimeSecretsV1 = values

  // Next.js keeps its own initial environment snapshot and restores it while
  // booting the production server. Register the freshly loaded values with
  // that snapshot before importing the CLI; otherwise keys that were absent
  // when PM2 spawned the worker (notably the Discord webhooks) are deleted
  // before instrumentation starts the durable monitors.
  const nextEnvModule = await import('@next/env')
  const { processEnv, updateInitialEnv } = nextEnvModule.default ?? nextEnvModule
  processEnv([], process.cwd())
  updateInitialEnv(values)

  log(
    `Loaded ${RUNTIME_SECRET_KEYS.length} validated runtime secrets from AWS Secrets Manager into the production worker.`,
  )

  // Importing the CLI after installing the secret values keeps Next.js in this
  // PM2-managed process. That preserves cluster reloads while ensuring every
  // restart and machine reboot retrieves the current secret through the EC2
  // instance role instead of relying on PM2's saved environment snapshot.
  await runNext()
}

// PM2 loads application scripts through its process container, so this entry
// point must run on module evaluation rather than relying on process.argv[1]
// matching this file.
startProduction().catch((error) => {
  const detail = error instanceof Error ? error.message : 'Unknown error'
  console.error(`Could not start subnet dashboard production worker: ${detail}`)
  process.exitCode = 1
})
