import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

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
for (const [name, workflow] of [['deploy', deploy], ['PR checks', checks]]) {
  assert.match(workflow, /node-version: 22\.23\.4/u, `${name} uses the release runtime`)
  assert.match(workflow, /bash scripts\/ensure-production-node\.sh/u, `${name} verifies its archive`)
}
assert.match(installer, /node_version=22\.23\.4/u)
assert.match(installer, /sha256sum --check --status/u)
assert.match(installer, /flock -w 180 9/u)
assert.match(installer, /mv -Tn "\$staging\/runtime" "\$runtime_dir"/u)
assert.ok(deploy.indexOf('git merge --ff-only origin/main') < deploy.indexOf('NODE_BIN="$(bash'))
assert.ok(deploy.indexOf('NODE_BIN="$(bash') < deploy.indexOf('npm ci --omit=dev'))
assert.ok(deploy.indexOf('npm ci --omit=dev') < deploy.indexOf('--interpreter "$NODE_BIN"'))
assert.ok(deploy.indexOf('--interpreter "$NODE_BIN"') < deploy.indexOf('pm2 delete subnet-dashboard\n'))
assert.ok(deploy.indexOf('candidate_healthy" != true') < deploy.indexOf('pm2 delete subnet-dashboard\n'))
assert.match(deploy, /readlink -f "\/proc\/\$candidate_pid\/exe"/u)
assert.match(deploy, /readlink -f "\/proc\/\$promoted_pid\/exe"/u)
assert.match(deploy, /restore_previous_worker/u)
assert.match(deploy, /NEXT_DIST_DIR="\$ACTIVE_SLOT" pm2 start "\$PREVIOUS_ECOSYSTEM"/u)
assert.match(deploy, /rollback_needed=true/u)
assert.match(deploy, /ROLLBACK_SLOT_FILE=.*\.subnet-dashboard-rollback-slot/u)
assert.match(deploy, /cat "\$ROLLBACK_SLOT_FILE".*!= "\$ACTIVE_SLOT"/u)
assert.ok(deploy.indexOf('pm2 save\n            rollback_needed=false') > deploy.indexOf('pm2 delete subnet-dashboard\n'))

console.log('production-node-release: verified runtime is selected before install and PM2 handoff')
