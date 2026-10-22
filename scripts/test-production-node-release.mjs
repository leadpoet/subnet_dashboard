import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const config = require('../ecosystem.config.cjs')
const app = config.apps.find(({ name }) => name === 'subnet-dashboard')
assert.ok(app, 'production PM2 app exists')
assert.equal(app.exec_mode, 'fork')
assert.equal(app.instances, 1)
assert.equal(app.interpreter, path.join(
  os.homedir(), '.local', 'leadpoet-node', `v22.23.4-linux-${process.arch}`, 'bin', 'node',
))

const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8')
const checks = readFileSync('.github/workflows/pr-checks.yml', 'utf8')
const installer = readFileSync('scripts/ensure-production-node.sh', 'utf8')
const dependencies = readFileSync('scripts/production-dependencies.sh', 'utf8')
for (const [name, workflow] of [['deploy', deploy], ['PR checks', checks]]) {
  assert.match(workflow, /node-version: 22\.23\.4/u, `${name} uses the release runtime`)
  assert.match(workflow, /bash scripts\/ensure-production-node\.sh/u, `${name} verifies its archive`)
}
assert.match(installer, /node_version=22\.23\.4/u)
assert.match(installer, /sha256sum --check --status/u)
assert.match(installer, /flock -w 180 9/u)
assert.match(installer, /mv -Tn "\$staging\/runtime" "\$runtime_dir"/u)
assert.match(dependencies, /npm ci --omit=dev --no-audit --no-fund --prefix "\$stage"/u)
assert.ok(deploy.indexOf('git merge --ff-only origin/main') < deploy.indexOf('NODE_BIN="$(bash'))
assert.ok(deploy.indexOf('NODE_BIN="$(bash') < deploy.indexOf('production_deps_stage "$APP_ROOT" "$DEPS_STAGE"'))
assert.ok(deploy.indexOf('production_deps_stage "$APP_ROOT" "$DEPS_STAGE"') < deploy.indexOf('production_deps_activate "$APP_ROOT" "$DEPS_STAGE" "$ROLLBACK_DEPENDENCIES"'))
assert.ok(deploy.indexOf('production_deps_activate "$APP_ROOT" "$DEPS_STAGE" "$ROLLBACK_DEPENDENCIES"') < deploy.indexOf('--interpreter "$NODE_BIN"'))
assert.ok(deploy.indexOf('--interpreter "$NODE_BIN"') < deploy.indexOf('pm2 delete subnet-dashboard\n'))
assert.ok(deploy.indexOf('candidate_healthy" != true') < deploy.indexOf('pm2 delete subnet-dashboard\n'))
assert.match(deploy, /readlink -f "\/proc\/\$candidate_pid\/exe"/u)
assert.match(deploy, /readlink -f "\/proc\/\$promoted_pid\/exe"/u)
assert.match(deploy, /restore_previous_worker/u)
assert.match(deploy, /NEXT_DIST_DIR="\$ACTIVE_SLOT" pm2 start "\$PREVIOUS_ECOSYSTEM"/u)
const rollback = deploy.slice(deploy.indexOf('restore_previous_worker() {'))
assert.ok(rollback.indexOf('production_deps_restore "$APP_ROOT" "$ROLLBACK_DEPENDENCIES"') < rollback.indexOf('NEXT_DIST_DIR="$ACTIVE_SLOT" pm2 start "$PREVIOUS_ECOSYSTEM"'))
assert.ok(deploy.indexOf('trap promotion_exit EXIT') < deploy.indexOf('production_deps_stage "$APP_ROOT" "$DEPS_STAGE"'))
assert.match(deploy, /rollback_needed=true/u)
assert.match(deploy, /ROLLBACK_SLOT_FILE=.*\.subnet-dashboard-rollback-slot/u)
assert.match(deploy, /cat "\$ROLLBACK_SLOT_FILE".*!= "\$ACTIVE_SLOT"/u)
const ownerGuardStart = deploy.indexOf('            # A previous switch may have stopped')
const ownerGuardEnd = deploy.indexOf('            echo "Starting bounded EC2 disk recovery"', ownerGuardStart)
assert.ok(ownerGuardStart > 0 && ownerGuardEnd > ownerGuardStart)
assert.ok(ownerGuardEnd < deploy.indexOf('rm -rf "$APP_ROOT/$CANDIDATE_SLOT"'))
assert.ok(ownerGuardEnd < deploy.indexOf('cp ecosystem.config.cjs "$PREVIOUS_ECOSYSTEM.next"'))

// Execute the actual pre-cleanup guard. An interrupted green promotion still
// owns its green dependency tree; the blue rollback tree and build must remain
// untouched, even though PM2 corrected a stale blue pointer to green.
const ownerFixture = mkdtempSync(path.join(os.tmpdir(), 'dashboard-rollback-owner-'))
try {
  const rollbackSlot = path.join(ownerFixture, 'rollback-slot')
  const rollbackConfig = path.join(ownerFixture, 'rollback.config.cjs')
  const rollbackDependencies = path.join(ownerFixture, 'rollback-node-modules')
  const activeDependencies = path.join(ownerFixture, 'node_modules')
  const oldBuild = path.join(ownerFixture, '.next-blue')
  mkdirSync(rollbackDependencies)
  mkdirSync(activeDependencies)
  mkdirSync(oldBuild)
  writeFileSync(rollbackSlot, '.next-blue\n')
  writeFileSync(rollbackConfig, 'module.exports = { apps: [] };\n')
  writeFileSync(path.join(rollbackDependencies, 'identity'), 'blue-old\n')
  writeFileSync(path.join(activeDependencies, 'identity'), 'green-new\n')
  writeFileSync(path.join(oldBuild, 'BUILD_ID'), 'blue-build\n')
  const actualGuard = deploy.slice(ownerGuardStart, ownerGuardEnd)
  const destructiveRetry = `${actualGuard}\nrm -rf "$CANDIDATE_SLOT"\nprintf '%s\\n' "$RUNNING_SLOT" > "$ROLLBACK_SLOT_FILE"\n`
  const env = {
    ...process.env,
    RUNNING_SLOT: '.next-green',
    ACTIVE_SLOT: '.next-green',
    CANDIDATE_SLOT: oldBuild,
    ROLLBACK_SLOT_FILE: rollbackSlot,
    PREVIOUS_ECOSYSTEM: rollbackConfig,
    ROLLBACK_DEPENDENCIES: rollbackDependencies,
  }
  const retry = spawnSync('bash', ['-c', `set -euo pipefail\n${destructiveRetry}`], { env, encoding: 'utf8' })
  assert.equal(retry.status, 1, retry.stderr)
  assert.match(retry.stdout, /Saved rollback slot does not own the running process/u)
  assert.equal(readFileSync(rollbackSlot, 'utf8'), '.next-blue\n')
  assert.equal(readFileSync(rollbackConfig, 'utf8'), 'module.exports = { apps: [] };\n')
  assert.equal(readFileSync(path.join(rollbackDependencies, 'identity'), 'utf8'), 'blue-old\n')
  assert.equal(readFileSync(path.join(activeDependencies, 'identity'), 'utf8'), 'green-new\n')
  assert.equal(readFileSync(path.join(oldBuild, 'BUILD_ID'), 'utf8'), 'blue-build\n')

  rmSync(rollbackSlot)
  const missingOwner = spawnSync('bash', ['-c', `set -euo pipefail\n${destructiveRetry}`], { env, encoding: 'utf8' })
  assert.equal(missingOwner.status, 1, missingOwner.stderr)
  assert.ok(!existsSync(rollbackSlot))
  assert.equal(readFileSync(path.join(oldBuild, 'BUILD_ID'), 'utf8'), 'blue-build\n')
} finally {
  rmSync(ownerFixture, { recursive: true, force: true })
}
assert.ok(deploy.indexOf('pm2 save\n            rollback_needed=false') > deploy.indexOf('pm2 delete subnet-dashboard\n'))
assert.ok(deploy.indexOf('rm -rf "$ROLLBACK_DEPENDENCIES"') > deploy.indexOf('pm2 save\n            rollback_needed=false'))

console.log('production-node-release: verified runtime is selected before install and PM2 handoff')
