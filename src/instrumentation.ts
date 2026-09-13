/** Load the reviewed runtime secret before server handlers start. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const [{ loadRuntimeSecretValues }, { installRuntimeSecretEnvironment }] =
      await Promise.all([
        import('../scripts/load-runtime-secret.mjs'),
        import('./lib/runtime-secret-environment'),
      ])
    const runtimeSecretValues = await loadRuntimeSecretValues()
    installRuntimeSecretEnvironment(runtimeSecretValues)
    console.log(
      `[runtime_secrets] loaded ${Object.keys(runtimeSecretValues).length} validated values ` +
        'inside Next.js instrumentation',
    )
  }
}
