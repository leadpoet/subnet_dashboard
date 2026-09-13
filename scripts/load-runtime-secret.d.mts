export const RUNTIME_SECRET_KEYS: readonly [
  'ADMIN_USER',
  'ADMIN_PASS',
  'ADMIN_SESSION_SECRET',
]

export function loadRuntimeSecretValues(): Promise<
  Record<(typeof RUNTIME_SECRET_KEYS)[number], string>
>
