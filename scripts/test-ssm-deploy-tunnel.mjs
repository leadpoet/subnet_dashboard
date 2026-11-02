import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const DASHBOARD_INSTANCE = 'i-0e428b150faa9d20f'
const VALIDATOR_INSTANCE = 'i-07ab2b90c537d0f28'
const ROLE_ARN = 'arn:aws:iam::493765492819:role/leadpoet-subnet-dashboard-github-deploy'

const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8')
const template = readFileSync('infra/github-deploy-role.yml', 'utf8')
const dashboardJob = deploy.slice(deploy.indexOf('  deploy:\n'), deploy.indexOf('  deploy-weights-alert:'))
const validatorJob = deploy.slice(deploy.indexOf('  deploy-weights-alert:'))

// Production security groups have no inbound port 22, so no step may dial a
// host directly or through the old dashboard bastion.
assert.doesNotMatch(deploy, /secrets\.EC2_HOST|proxy_host|proxy_key|172\.31\.29\.188/u)
for (const [name, job, instance] of [['dashboard', dashboardJob, DASHBOARD_INSTANCE], ['validator', validatorJob, VALIDATOR_INSTANCE]]) {
  assert.match(job, /permissions:\n {6}contents: read\n {6}id-token: write\n/u, `${name} job can request an OIDC token`)
  assert.match(job, new RegExp(`role-to-assume: ${ROLE_ARN}\n`, 'u'), `${name} job assumes the deploy role`)
  assert.match(job, /role-session-name: subnet-dashboard-deploy-\$\{\{ github\.run_id \}\}/u)
  assert.match(job, new RegExp(`bash scripts/ssm-ssh-tunnel\\.sh open ${instance} 2222\n`, 'u'), `${name} job tunnels to its own host`)
  const sshTargets = job.match(/^ {10}host: .*$/gmu) ?? []
  assert.ok(sshTargets.length >= 2 && sshTargets.every((line) => line.endsWith('host: 127.0.0.1')), `${name} SSH steps use the tunnel`)
  assert.equal((job.match(/^ {10}port: 2222$/gmu) ?? []).length, sshTargets.length)
  const close = job.indexOf('      - name: Close SSH tunnel\n        if: always()\n        run: bash scripts/ssm-ssh-tunnel.sh close\n')
  assert.ok(close > job.lastIndexOf('uses: appleboy/'), `${name} job closes the tunnel after its last SSH step`)
  assert.ok(job.indexOf('ssm-ssh-tunnel.sh open') < job.indexOf('uses: appleboy/'), `${name} tunnel opens before SSH`)
  assert.ok(job.indexOf('role-to-assume:') < job.indexOf('ssm-ssh-tunnel.sh open'), `${name} credentials exist before the tunnel opens`)
}
assert.ok(dashboardJob.indexOf('ssm-ssh-tunnel.sh open') > dashboardJob.indexOf('npm run build'), 'the tunnel is not idle during the runner build')
assert.ok(dashboardJob.indexOf('Close SSH tunnel') < dashboardJob.indexOf('Verify public production path'))
for (const line of deploy.match(/^ {10}envs: .*$/gmu) ?? []) {
  assert.doesNotMatch(line, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN/u, 'deploy credentials never reach the hosts')
}

// The role trusts only main of this repository and forwards only to these hosts.
assert.match(template, /token\.actions\.githubusercontent\.com:aud: sts\.amazonaws\.com/u)
assert.deepEqual(
  [...template.matchAll(/^ {18}- (repo:.*)$/gmu)].map((match) => match[1]),
  ['repo:leadpoet/subnet_dashboard:ref:refs/heads/main', 'repo:leadpoet@237783076/subnet_dashboard@1123583904:ref:refs/heads/main'],
)
const policy = template.slice(template.indexOf('      Policies:'), template.indexOf('\nOutputs:'))
assert.deepEqual(
  [...policy.matchAll(/\b(?:ssm|ssmmessages|[a-z0-9-]+):[A-Z][A-Za-z]+\b|Action: ['"]?\*/gu)].map((match) => match[0]).sort(),
  ['ssm:ResumeSession', 'ssm:SessionDocumentAccessCheck', 'ssm:StartSession', 'ssm:TerminateSession', 'ssmmessages:OpenDataChannel'],
  'the role grants only port forwarding and access to its own sessions',
)
assert.deepEqual(
  [...policy.matchAll(/arn:aws:[^\s'"]+/gu)].map((match) => match[0].replace(/^.*:(?=instance\/|document\/|session\/)/u, '')),
  [
    `instance/${DASHBOARD_INSTANCE}`,
    `instance/${VALIDATOR_INSTANCE}`,
    'document/AWS-StartPortForwardingSession',
    'session/subnet-dashboard-deploy-*',
    'session/${!aws:userid}-*',
  ],
)
assert.match(policy, /BoolIfExists:\n {20}ssm:SessionDocumentAccessCheck: 'true'/u, 'shell sessions stay blocked')
assert.doesNotMatch(policy, /(?:(?:Action|Resource):|-) ['"]?\*['"]?\s*$|[:/]\*['"]?\s*$/mu, 'no wildcard actions or resources')

// Run the real tunnel script against a fake AWS CLI that serves an SSH banner.
const freePort = await new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => resolve(port))
  })
})
const root = mkdtempSync(path.join(os.tmpdir(), 'ssm-ssh-tunnel-'))
const bin = path.join(root, 'bin')
const calls = path.join(root, 'aws-calls.log')
const state = path.join(root, 'state')
const writeExecutable = (name, body) => {
  const file = path.join(bin, name)
  writeFileSync(file, body)
  chmodSync(file, 0o755)
}
try {
  spawnSync('mkdir', ['-p', bin])
  writeExecutable('session-manager-plugin', '#!/bin/sh\necho 1.2.896.0\n')
  if (spawnSync('sh', ['-c', 'command -v timeout']).status !== 0) {
    writeExecutable('timeout', '#!/bin/sh\nshift\nexec "$@"\n')
  }
  writeExecutable('aws', `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> ${JSON.stringify(calls)}
if [ "$1 $2" = "ssm terminate-session" ]; then exit 0; fi
if [ "\${FAKE_SSM_FAIL:-}" = 1 ]; then echo "An error occurred (AccessDeniedException)" >&2; exit 254; fi
port="$(printf '%s' "$*" | sed -n 's/.*localPortNumber=\\([0-9]*\\).*/\\1/p')"
echo "Starting session with SessionId: subnet-dashboard-deploy-7-0abc123"
echo "Port $port opened for sessionId subnet-dashboard-deploy-7-0abc123."
exec python3 -c '
import socket, sys
server = socket.socket()
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("127.0.0.1", int(sys.argv[1])))
server.listen()
while True:
    connection, _ = server.accept()
    connection.sendall(b"SSH-2.0-OpenSSH_test\\r\\n")
    connection.close()
' "$port"
`)
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, SSM_TUNNEL_STATE_DIR: state }
  const run = (args, extra = {}) => spawnSync('bash', ['scripts/ssm-ssh-tunnel.sh', ...args], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 90_000 })

  const opened = run(['open', DASHBOARD_INSTANCE, String(freePort)])
  assert.equal(opened.status, 0, opened.stdout + opened.stderr)
  assert.match(opened.stdout, new RegExp(`SSH on ${DASHBOARD_INSTANCE} answers through Session Manager at 127\\.0\\.0\\.1:${freePort}`, 'u'))
  assert.match(readFileSync(calls, 'utf8'), new RegExp(`ssm start-session --target ${DASHBOARD_INSTANCE} --document-name AWS-StartPortForwardingSession --parameters portNumber=22,localPortNumber=${freePort}\n`, 'u'))
  const tunnelPid = Number(readFileSync(path.join(state, 'session.pid'), 'utf8'))
  assert.equal(spawnSync('kill', ['-0', String(tunnelPid)]).status, 0, 'the tunnel keeps running for later steps')

  const closed = run(['close'])
  assert.equal(closed.status, 0, closed.stdout + closed.stderr)
  assert.match(readFileSync(calls, 'utf8'), /ssm terminate-session --session-id subnet-dashboard-deploy-7-0abc123\n/u)
  assert.equal(existsSync(state), false)
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.notEqual(spawnSync('kill', ['-0', String(tunnelPid)]).status, 0, 'close stops the tunnel process')
  assert.equal(run(['close']).status, 0, 'closing twice is harmless, as in an always() step')

  const denied = run(['open', VALIDATOR_INSTANCE, String(freePort)], { FAKE_SSM_FAIL: '1' })
  assert.notEqual(denied.status, 0)
  assert.match(denied.stdout, /tunnel to i-07ab2b90c537d0f28 exited[\s\S]*AccessDeniedException/u, 'a refused session fails with its AWS error')
  run(['close'])
  assert.equal(run(['open']).status, 2)
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('ssm-deploy-tunnel: OIDC role scope, tunnel-only SSH targets, and real tunnel open/close passed')
