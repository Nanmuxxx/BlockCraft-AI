import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createProcessReaper } from '../../server/safe-viewer/process-reaper.mjs'

async function startDecoy() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], {
    stdio: 'ignore',
  })
  await once(child, 'spawn')
  return child
}

async function stopDecoy(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  try { child.kill('SIGKILL') } catch {}
  await Promise.race([
    once(child, 'exit'),
    new Promise(resolve => setTimeout(resolve, 2_000)),
  ])
}

test('PID identity mismatch never kills the unrelated process', { timeout: 15_000 }, async t => {
  const reaper = createProcessReaper()
  const first = await startDecoy()
  const second = await startDecoy()
  t.after(async () => {
    await stopDecoy(first)
    await stopDecoy(second)
  })
  const firstIdentity = await reaper.inspect(first.pid)
  const secondIdentity = await reaper.inspect(second.pid)
  assert.ok(firstIdentity?.identity)
  assert.ok(secondIdentity?.identity)
  assert.notEqual(first.pid, second.pid)

  const refused = await reaper.terminatePid(first.pid, { ...secondIdentity, pid: first.pid })
  assert.equal(refused.ok, true)
  assert.equal(refused.status, 'pid-reused')
  const stillAlive = await reaper.inspect(first.pid)
  assert.equal(stillAlive?.identity, firstIdentity.identity)

  const cleaned = await reaper.terminatePid(first.pid, firstIdentity)
  assert.equal(cleaned.ok, true)
  assert.equal(await reaper.inspect(first.pid), null)

  const cleanedSecond = await reaper.terminatePid(second.pid, secondIdentity)
  assert.equal(cleanedSecond.ok, true)
  assert.equal(await reaper.inspect(second.pid), null)
})
