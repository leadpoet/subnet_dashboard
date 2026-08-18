import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const configUrl = pathToFileURL('next.config.mjs').href
const previousNodeEnv = process.env.NODE_ENV

try {
  process.env.NODE_ENV = 'development'
  const developmentConfig = (await import(`${configUrl}?development`)).default
  assert.equal(developmentConfig.env.DASHBOARD_BUILD_VERSION, 'dev')

  process.env.NODE_ENV = 'production'
  const firstProductionConfig = (await import(`${configUrl}?production-1`)).default
  await new Promise((resolve) => setTimeout(resolve, 5))
  const secondProductionConfig = (await import(`${configUrl}?production-2`)).default

  assert.match(firstProductionConfig.env.DASHBOARD_BUILD_VERSION, /^\d+$/)
  assert.notEqual(
    firstProductionConfig.env.DASHBOARD_BUILD_VERSION,
    secondProductionConfig.env.DASHBOARD_BUILD_VERSION,
    'separate production builds must receive different reload versions',
  )

  const serverDataSource = await readFile('src/lib/server-data.ts', 'utf8')
  assert.match(serverDataSource, /process\.env\.DASHBOARD_BUILD_VERSION/)
  assert.doesNotMatch(serverDataSource, /process\.env\.BUILD_TIME/)

  console.log('Dashboard build version tests passed')
} finally {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousNodeEnv
}
