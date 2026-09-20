import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('App policy-repair recovery', () => {
  it('restores automatic repair, baseline, and conflict prompts', () => {
    expect(source).toMatch(/const repairDispatchRef = useRef\(new Set<string>\(\)\)/)
	expect(source).toMatch(/!\['repair_pending', 'baseline_update_pending', 'conflict_resolution_pending'\]\.includes\(session\.state\)/)
	expect(source).toMatch(/session\.state === 'conflict_resolution_pending'\) void submitConflictPrompt\(session, targetChat\)/)
    expect(source).toMatch(/void submitRepairPrompt\(session, targetChat\)/)
	expect(source).toMatch(/void transportPlannerContinuation\(session, targetChat\)\.catch/)
  })

  it('recovers every inactive auto continuation through durable background workers', () => {
	const recovery = source.slice(source.indexOf('const requests = pendingBundleRequestIDs(candidate)') - 2400, source.indexOf('const requests = pendingBundleRequestIDs(candidate)') + 100)
	expect(recovery).toContain("['conflict_resolution_pending', 'repair_pending', 'workflow_pending', 'baseline_update_pending'].includes(candidate.state)")
	expect(recovery).toContain("candidate.state === 'awaiting_plan' && Number(candidate.remote_recovery_attempt || 0) > 0")
	expect(recovery).toContain('isAutomaticAutomationMode(candidate.automation_mode)')
	expect(recovery).toMatch(/api\.chatAgentTasksForRequest\(continuationRequestID\)/)
	expect(recovery).toMatch(/failedWrites < 3/)
	expect(recovery).toMatch(/await submitConflictPrompt\(candidate, chat, true\)/)
	expect(recovery).toMatch(/await submitRepairPrompt\(candidate, chat, true\)/)
	expect(recovery).toMatch(/await submitWorkflowPrompt\(candidate, chat, true\)/)
	expect(recovery).toMatch(/await transportPlannerContinuation\(candidate, chat\)/)
	expect(source).toMatch(/window\.setInterval\(\(\) => \{ void reconcile\(\) \}, 30_000\)/)

	const continuation = source.slice(source.indexOf('async function transportPlannerContinuation'), source.indexOf('async function submitConflictPrompt'))
	expect(continuation).toMatch(/cacheKey, background: true/)
	expect(continuation).toMatch(/!dedicatedConflict \? \{ workspaceChatId: targetChat\.id \}/)
  })

  it('dispatches a conflict immediately after importing the bundle that prepared it', () => {
	const submission = source.slice(source.indexOf('async function submitBundleFile'), source.indexOf('async function recoverInterruptedExecution'))
	expect(submission).toMatch(/submission\.conflict_prepared && updated\.state === 'conflict_resolution_pending'/)
	expect(submission).toMatch(/await submitConflictPrompt\(updated, targetChat\)/)
  })

  it('does not let a diagnostic conflict notice suppress a transport retry', () => {
	expect(source).toMatch(/requestAlreadyRecorded\(conflictedSession\.project_path, targetChat\.id, conflict\.request_id, \['prepared', 'submitted'\]\)/)
	expect(source).not.toMatch(/conflict\.request_id, \['conflict', 'prepared', 'submitted'\]/)
	expect(source).toMatch(/if \(force\) repairDispatchRef\.current\.delete\(dispatchKey\)/)
  })

  it('retries an already-authorized host integration without a second confirmation', () => {
    const applyStart = source.indexOf('async function apply()')
    const applyEnd = source.indexOf('async function retryDependencyNetwork()', applyStart)
    const applyBody = source.slice(applyStart, applyEnd)

    expect(applyBody).not.toMatch(/confirmDialog\(/)
    expect(applyBody).toMatch(/await api\.apply\(targetSession\.id\)/)
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
    const retry = source.slice(source.indexOf('async function retryTransportFailure('), source.indexOf('async function cancelPendingRequest('))
    const targetCapture = retry.indexOf('const targetSession = session')
    const request = retry.indexOf('await api.retryFailedRequest(targetSession.id)')

    expect(targetCapture).toBeGreaterThan(-1)
    expect(request).toBeGreaterThan(targetCapture)
    expect(retry).toMatch(/transportPlannerContinuation\(retried, targetChat\)/)
    expect(source).not.toMatch(/const original = \[\.\.\.items\]\.reverse\(\)/)
  })
})
