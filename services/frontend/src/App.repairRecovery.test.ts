import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('App policy-repair recovery', () => {
  it('restores automatic repair, conflict, and legacy baseline prompts without bypassing durable dispatch guards', () => {
    expect(source).toMatch(/const repairDispatchRef = useRef\(new Set<string>\(\)\)/)
	expect(source).toMatch(/!\['repair_pending', 'conflict_resolution_pending', 'baseline_update_pending'\]\.includes\(session\.state\)/)
    expect(source).toMatch(/void submitRepairPrompt\(session, targetChat\)/)
	expect(source).toMatch(/void transportPlannerContinuation\(session, targetChat\)\.catch/)
  })

  it('dispatches a prepared repair immediately after a manual host Apply failure', () => {
    const applyStart = source.indexOf('async function apply()')
    const applyEnd = source.indexOf('async function retryDependencyNetwork()', applyStart)
    const applyBody = source.slice(applyStart, applyEnd)

    expect(applyBody).toMatch(/latest\.state === 'repair_pending'/)
    expect(applyBody).toMatch(/await submitRepairPrompt\(latest, targetChat\)/)
  })

  it('sends each repair request only once across app lifetimes and exposes a delivery failure', () => {
    expect(source).toMatch(/const requestId = failedSession\.last_request_id \|\| ''/)
    expect(source).toMatch(/requestAlreadyRecorded\(failedSession\.project_path, targetChat\.id, requestId, \['repair', 'prepared', 'submitted'\]\)/)
    expect(source).toMatch(/repairDispatchRef\.current\.has\(dispatchKey\)/)
    expect(source).toMatch(/setError\(messageOf\(sendError\)\)/)
  })

  it('does not confuse the original submitted request with a workflow continuation dispatch', () => {
    expect(source).toMatch(/requestAlreadyRecorded\(workflowSession\.project_path, targetChat\.id, requestId, \['workflow'\]\)/)
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
