import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createChatAgentCapacityAvailability } from './availability.mjs'

test('scaling the Supervisor pool reaches the Supervisor scheduler, not the Worker one', async () => {
  const source = await readFile(new URL('./availability.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function setChatAgentSupervisorTarget(')
  const fn = source.slice(start, source.indexOf('\n  function chatAgentAvailableSupervisors', start))

  // Each pool owns one claim loop per slot, and the count has to reach the
  // scheduler that runs those loops. Sending the Supervisor count to
  // chatAgentScheduler left the Supervisor pool frozen at its construction
  // count — neither the operator's stepper nor Auto scale could add one — while
  // silently resizing the Worker pool to the Supervisor number.
  assert.match(fn, /chatSupervisorScheduler\?\.setSupervisorCount\(normalized\)/)
  assert.doesNotMatch(fn, /chatAgentScheduler\?\.setSupervisorCount/)

  const workerStart = source.indexOf('function setChatAgentWorkerTarget(')
  const workerFn = source.slice(workerStart)
  assert.match(workerFn, /chatAgentScheduler\?\.setWorkerCount\(normalized\)/)
})
