import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import React, { useCallback, useState } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import ts from 'typescript'

const require = createRequire(import.meta.url)
let now = 0
let nextTimer = 0
let visibility = 'visible'
const timers = new Map()
const listeners = new Set()
const browser = {
  setTimeout(callback, delay) {
    const id = ++nextTimer
    timers.set(id, { callback, at: now + delay })
    return id
  },
  clearTimeout(id) { timers.delete(id) },
}
const document = {
  get visibilityState() { return visibility },
  addEventListener(type, listener) { assert.equal(type, 'visibilitychange'); listeners.add(listener) },
  removeEventListener(type, listener) { assert.equal(type, 'visibilitychange'); listeners.delete(listener) },
}
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/hooks/useVisiblePolling.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { module, exports: module.exports, require, window: browser, document })
const { useVisiblePolling } = module.exports

function Panel({ enabled, poll }) {
  const [completed, setCompleted] = useState(0)
  const refresh = useCallback(async () => {
    await poll()
    setCompleted((value) => value + 1)
  }, [poll])
  useVisiblePolling(refresh, 60_000, { enabled })
  return React.createElement('output', null, completed)
}

async function advance(ms) {
  const end = now + ms
  while (true) {
    const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
    if (!next) break
    const [id, timer] = next
    now = timer.at
    timers.delete(id)
    await act(async () => { timer.callback() })
  }
  now = end
}

async function setVisibility(value) {
  visibility = value
  await act(async () => { for (const listener of [...listeners]) listener() })
}

function deferred() {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}

let renderer
try {
  let calls = 0
  const poll = async () => { calls++ }
  await act(async () => { renderer = TestRenderer.create(React.createElement(Panel, { enabled: true, poll })) })
  assert.equal(calls, 1)
  await advance(5 * 60_000)
  assert.equal(calls, 6)
  await setVisibility('hidden')
  assert.equal(timers.size, 0)
  await advance(5 * 60_000)
  assert.equal(calls, 6)
  await setVisibility('visible')
  assert.equal(calls, 7, 'a visible panel refreshes immediately after resume')

  const pending = deferred()
  let slowCalls = 0
  let simultaneous = 0
  let maxSimultaneous = 0
  const slow = async () => {
    slowCalls++
    simultaneous++
    maxSimultaneous = Math.max(maxSimultaneous, simultaneous)
    try { if (slowCalls === 1) await pending.promise } finally { simultaneous-- }
  }
  await act(async () => { renderer.update(React.createElement(Panel, { enabled: true, poll: slow })) })
  await advance(3 * 60_000)
  assert.equal(slowCalls, 1, 'a slow request cannot overlap the next interval')
  await act(async () => { pending.resolve() })
  await advance(60_000)
  assert.equal(slowCalls, 2)
  assert.equal(maxSimultaneous, 1)

  await act(async () => { renderer.unmount() })
  assert.equal(listeners.size, 0)
  assert.equal(timers.size, 0)

  const shell = readFileSync('src/components/dashboard/DashboardClient.tsx', 'utf8')
  const lab = readFileSync('src/components/dashboard/ResearchLab.tsx', 'utf8')
  assert.match(shell, /<ResearchLab active=\{activeTab === 'research-lab'\}/)
  assert.match(shell, /mountedTabs\.has\('research-lab'\)/)
  assert.doesNotMatch(shell, /Fulfillment|\/api\/dashboard/)
  assert.match(lab, /useVisiblePolling\(fetchData, 60_000, \{ enabled: active \}\)/)
  assert.doesNotMatch(lab, /setInterval\([^\n]*fetchData/)
  console.log('visible-polling: visibility pause, immediate resume, request coalescing, cleanup, and Arena-only shell passed')
} finally {
  await act(async () => { renderer?.unmount() })
}
