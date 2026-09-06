import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('App policy-repair recovery', () => {
  it('resubmits persisted automatic repair, conflict, and legacy baseline prompts when their chat is restored', () => {
    expect(source).toMatch(/const repairDispatchRef = useRef\(new Set<string>\(\)\)/)
	expect(source).toMatch(/!\['repair_pending', 'conflict_resolution_pending', 'baseline_update_pending'\]\.includes\(session\.state\)/)
    expect(source).toMatch(/void submitRepairPrompt\(session, targetChat\)/)
	expect(source).toMatch(/void transportPlannerContinuation\(session, targetChat\)\.catch/)
  })

  it('sends each repair request only once per app lifetime and exposes a delivery failure', () => {
    expect(source).toMatch(/const dispatchKey = `\$\{failedSession\.id\}:\$\{failedSession\.last_request_id \|\| attempt\}`/)
    expect(source).toMatch(/repairDispatchRef\.current\.has\(dispatchKey\)/)
    expect(source).toMatch(/setError\(messageOf\(sendError\)\)/)
  })

  it('never seeds a new dedicated conflict surface with the main ChatGPT conversation', () => {
	expect(source).toMatch(/const dedicatedURL = surface\?\.url && !sameChatGPTConversation\(surface\.url, targetChat\.chatgptUrl\)/)
	expect(source).toMatch(/const targetURL = dedicatedConflict \? dedicatedURL : targetChat\.chatgptUrl/)
  })

  it('retries a terminal protocol failure through a fresh durable backend request', () => {
	expect(source).toMatch(/api\.retryFailedRequest\(session\.id\)/)
	expect(source).toMatch(/transportPlannerContinuation\(retried, targetChat\)/)
	expect(source).not.toMatch(/const original = \[\.\.\.items\]\.reverse\(\)/)
  })
})
