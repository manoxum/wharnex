import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createWorkerScheduler, createTranslatorScheduler, createSupervisorScheduler } from './index.mjs'

class CapturedScheduler {
  constructor(options) { this.options = options }
}

test('Desktop creates each scheduler before starting it and defers the Worker pool until after local paint', async () => {
  const main = await readFile(new URL('../../../main.mjs', import.meta.url), 'utf8')
  const startup = main.slice(main.indexOf('app.whenReady().then('), main.indexOf("app.on('before-quit'"))
  const markers = [
    'chatAgentScheduler = createWorkerScheduler({',
    'setTimeout(async () => {',
    'chatAgentScheduler.start()',
    'chatTranslatorScheduler = createTranslatorScheduler({',
    'chatTranslatorScheduler.start()',
    'chatSupervisorScheduler = createSupervisorScheduler({',
    'chatSupervisorScheduler.start()',
    'void refreshChatAgentRuntimeState()',
  ]
  const positions = markers.map((marker) => startup.indexOf(marker))
  assert.ok(positions.every((position) => position >= 0), 'all startup steps are present')
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b))
  assert.match(startup, /setTimeout\(async \(\) => \{[\s\S]*await primeChatGPTWorkerPool\(workerHost\)[\s\S]*chatAgentScheduler\.start\(\)[\s\S]*\}, CHAT_AGENT_STARTUP_DELAY_MS\)/)
})

test('Worker claims obey current suspension and exclude Supervisor lanes before reaching the queue', () => {
  let policy = { paused: false, task_types: [] }
  let providerBlocked = false
  const released = []
  const entry = { slotId: 'worker-1', interactionWindowId: '', accountOperationActive: false, transportPreparationCount: 0, loading: false }
  const scheduler = createWorkerScheduler({
    ChatAgentSchedulerClient: CapturedScheduler, BACKEND_URL: 'http://localhost/', desiredChatAgentWorkerSlots: 1,
    HARD_MAX_WORKER_SLOTS: 3, getChatAgentPolicies: () => policy,
    workerSuspensionState: (current) => current,
    workerSuspendsAllTaskTypes: (current) => current.paused && current.task_types.length === 0,
    chatAgentRateLimitResumeBlocked: () => providerBlocked,
    workerEntryForIndex: () => entry, chatSupervisorBoundLanes: () => new Set(['owned-chat']),
    chatAgentResidency: {
      snapshot: () => ({ resident_lane: 'owned-chat' }),
      releaseResidentLane: (...args) => released.push(args),
      claimOptions: () => ({ preferred_lane: '', fallback_mode: 'any', excluded_lanes: ['cooldown-chat'] }),
    },
    chatAgentKeepFlowingActive: () => false,
    chatAgentSupervisingLiveResponse: () => false,
    projectWindowRegistry: { openProjects: () => ['/project'] },
    orchestrationTaskPins: {
      retain() {}, lane: () => '', lanesHeldByOthers: () => new Set(['pinned-chat']),
    },
    chatGPTWorkerEntries: [entry],
  })
  assert.equal(scheduler.options.role, 'worker')
  assert.deepEqual(scheduler.options.claimOptions(1), {
    preferred_lane: '', fallback_mode: 'any',
    excluded_lanes: ['pinned-chat', 'owned-chat'],
    project_scoped: true, open_projects: ['/project'], excluded_types: [],
  })
  assert.deepEqual(released, [['worker-1', 'owned-chat']])
  policy = { paused: true, task_types: ['ARCHIVE_CHAT'] }
  assert.deepEqual(scheduler.options.claimOptions(1).excluded_types, ['ARCHIVE_CHAT'])
  providerBlocked = true
  assert.deepEqual(scheduler.options.claimOptions(1), { skip: true })
  providerBlocked = false
  policy = { paused: true, task_types: [] }
  assert.deepEqual(scheduler.options.claimOptions(1), { skip: true })
})

test('Translator claim eligibility tracks current demand and a live Desktop window', () => {
  let due = 0
  const windows = new Map([['primary', { window: { isDestroyed: () => false } }]])
  const scheduler = createTranslatorScheduler({
    ChatAgentSchedulerClient: CapturedScheduler, BACKEND_URL: 'http://localhost/', MAX_TRANSLATOR_SLOTS: 2,
    desktopWindows: windows, getDueChatTranslations: () => due,
    projectWindowRegistry: { openProjects: () => ['/project'] },
    activeChatTranslatorSlots: new Set(),
  })
  assert.equal(scheduler.options.role, 'translator')
  assert.equal(scheduler.options.claimOptions().skip, true)
  due = 1
  assert.deepEqual(scheduler.options.claimOptions(), { skip: false, project_scoped: true, open_projects: ['/project'] })
  windows.clear()
  assert.equal(scheduler.options.claimOptions().skip, true)
})

test('Supervisor holds its bound lane and excludes another Supervisor’s lane when free', () => {
  let held = true
  const scheduler = createSupervisorScheduler({
    ChatAgentSchedulerClient: CapturedScheduler, BACKEND_URL: 'http://localhost/',
    desiredChatAgentSupervisorSlots: 2, HARD_MAX_SUPERVISOR_SLOTS: 6,
    chatSupervisorHostWindow: () => ({}), chatSupervisorStates: new Map([[1, { lane: 'own-lane', key: 'chat' }]]),
    sanitizeOptionalChatCacheKey: (key) => key, chatgptViews: new Map([['chat', {}]]),
    projectWindowRegistry: { openProjects: () => ['/project'] },
    supervisorBindingHeld: () => held,
    chatSupervisorLanesHeldByOthers: () => new Set(['other-lane']),
  })
  assert.equal(scheduler.options.role, 'supervisor')
  assert.deepEqual(scheduler.options.claimOptions(1), {
    preferred_lane: 'own-lane', fallback_mode: 'resident_only',
    project_scoped: true, open_projects: ['/project'],
  })
  held = false
  assert.deepEqual(scheduler.options.claimOptions(1), {
    preferred_lane: 'own-lane', fallback_mode: 'any', excluded_lanes: ['other-lane'],
    project_scoped: true, open_projects: ['/project'],
  })
})
