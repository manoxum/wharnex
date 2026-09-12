import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import type { WorkspaceChat } from '../lib/workspaceMemory'
import { Inspector } from './Inspector'

function legacySession(): Session {
  return {
    id: 'ses-legacy',
    project_path: '/tmp/demo',
    state: 'planned',
    execution_mode: 'protected',
    automation_mode: 'manual',
    created_at: new Date().toISOString(),
    context: {
      id: 'ctx-legacy',
      manifest: { id: 'ctx-legacy', project_root: '/tmp/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false },
    },
    plan: {
      protocol: 'harness.execution/v1',
      plan_id: 'plan-legacy',
      request_id: 'req-legacy',
      status: 'ready',
      summary: 'Plano sem operações',
      risk: 'low',
      requires_approval: false,
      operations: null as unknown as [],
      verification: null as unknown as [],
    },
    policy: { allowed: true, requires_approval: false, risk: 'low', reasons: [] },
  }
}

describe('Inspector plan compatibility', () => {
  it('opens a persisted plan whose operation collections are null', () => {
    render(<Inspector
      config={{ planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }}
      session={legacySession()}
      events={[]}
      manualPrompt=""
      busy={false}
      onChatGPTURL={() => true}
      onExecute={async () => undefined}
      onApply={async () => undefined}
      onManualPlan={async () => undefined}
      onPlanFile={async () => ''}
      onBundleFile={async () => ''}
      onSession={() => undefined}
    />)
    expect(screen.getByText('Plano sem operações')).toBeTruthy()
    expect(screen.getByText('Operações').parentElement?.textContent).toContain('0')
    expect(screen.getByText('Verificações').parentElement?.textContent).toContain('0')
  })
})

it('hides the execute control while the active plan already has a durable execution intent', () => {
  const session = legacySession()
  session.interrupted_execution = { plan_id: session.plan!.plan_id, requested_at: '2026-09-12T19:00:00.000Z', approved: false, status: 'running' }
  render(<Inspector
    config={{ planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }}
    session={session}
    events={[]}
    manualPrompt=""
    busy={false}
    onChatGPTURL={() => true}
    onExecute={async () => undefined}
    onApply={async () => undefined}
    onManualPlan={async () => undefined}
    onPlanFile={async () => ''}
    onBundleFile={async () => ''}
    onSession={() => undefined}
  />)
  expect(screen.queryByRole('button', { name: /^Executar$/i })).toBeNull()
})

it('shows workflow as a local probe without exposing change execution controls', () => {
  const session = legacySession()
  session.automation_mode = 'auto'
  session.workflow_round = 2
  session.last_turn = { protocol: 'harness.turn/v1', request_id: 'req-legacy', kind: 'workflow', message: 'Confirmar capacidade local.' }
  session.plan = {
    ...session.plan!,
    summary: 'Inspecionar capacidades existentes',
    operations: [{
      type: 'command', patch: '',
      command: { argv: ['git', 'status', '--short'], cwd: '.', timeout_seconds: 30, network: false, expected_exit_codes: [0] },
    }],
    verification: [],
  }
  render(<Inspector
    config={{ planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }}
    session={session}
    events={[{ id: 'evt-wf', session_id: session.id, type: 'workflow.started', timestamp: new Date().toISOString(), data: { round: 2 } }]}
    manualPrompt=""
    busy={false}
    onChatGPTURL={() => true}
    onExecute={async () => undefined}
    onApply={async () => undefined}
    onManualPlan={async () => undefined}
    onPlanFile={async () => ''}
    onBundleFile={async () => ''}
    onSession={() => undefined}
  />)
  expect(screen.getByText(/Workflow local 2\/6/i)).toBeTruthy()
  expect(screen.getByText('Probe autorizada')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Executar$/i })).toBeNull()
  expect(screen.queryByRole('button', { name: /Aplicar no host/i })).toBeNull()
})

it('offers apply and reject for a verified cumulative host candidate', () => {
  const session = legacySession()
  session.state = 'verified'
  session.last_execution = { plan_id: session.plan!.plan_id, success: true, started_at: new Date().toISOString(), completed_at: new Date().toISOString(), commands: [] }
  session.pending_host_changes = [
    { plan: session.plan!, execution: session.last_execution, verified_at: session.last_execution.completed_at },
    { plan: { ...session.plan!, plan_id: 'plan-fix', summary: 'Correção incremental' }, execution: { ...session.last_execution, plan_id: 'plan-fix' }, verified_at: session.last_execution.completed_at },
  ]
  const onApply = vi.fn(async () => undefined)
  const onReject = vi.fn(async () => undefined)
  render(<Inspector
    config={{ planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }}
    session={session}
    events={[]}
    manualPrompt=""
    busy={false}
    onChatGPTURL={() => true}
    onExecute={async () => undefined}
    onApply={onApply}
    onRejectPendingChanges={onReject}
    onManualPlan={async () => undefined}
    onPlanFile={async () => ''}
    onBundleFile={async () => ''}
    onSession={() => undefined}
  />)
  expect(screen.queryByRole('button', { name: /^Executar$/i })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Aplicar no host \(2\)/i }))
  fireEvent.click(screen.getByRole('button', { name: /^Rejeitar$/i }))
  expect(onApply).toHaveBeenCalledOnce()
  expect(onReject).toHaveBeenCalledOnce()
})


it('does not expose execution again after a self-evolution plan is applied or restart-pending', () => {
  for (const state of ['restart_pending', 'restart_scheduled', 'applied']) {
    const session = legacySession()
    session.self_evolution = true
    session.state = state
    session.last_execution = { plan_id: session.plan!.plan_id, success: true, started_at: new Date().toISOString(), completed_at: new Date().toISOString(), commands: [] }
    const { unmount } = render(<Inspector
      config={{ planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }}
      session={session}
      events={[]}
      manualPrompt=""
      busy={false}
      onChatGPTURL={() => true}
      onExecute={async () => undefined}
      onApply={async () => undefined}
      onManualPlan={async () => undefined}
      onPlanFile={async () => ''}
      onBundleFile={async () => ''}
      onSession={() => undefined}
    />)
    expect(screen.queryByRole('button', { name: /^Executar$/i })).toBeNull()
    unmount()
  }
})


it('blocks apply while a baseline adaptation is active', () => {
  const session = legacySession()
  session.state = 'baseline_update_pending'
  session.planner_in_flight = true
  session.last_execution = { plan_id: session.plan!.plan_id, success: true, started_at: new Date().toISOString(), completed_at: new Date().toISOString(), commands: [] }
  session.pending_host_changes = [
    { plan: session.plan!, execution: session.last_execution, verified_at: session.last_execution.completed_at },
  ]
  render(<Inspector
    config={{ planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }}
    session={session}
    events={[]}
    manualPrompt=""
    busy={false}
    onChatGPTURL={() => true}
    onExecute={async () => undefined}
    onApply={async () => undefined}
    onRejectPendingChanges={async () => undefined}
    onManualPlan={async () => undefined}
    onPlanFile={async () => ''}
    onBundleFile={async () => ''}
    onSession={() => undefined}
  />)
  expect(screen.queryByRole('button', { name: /Aplicar no host/i })).toBeNull()
  expect(screen.queryByRole('button', { name: /^Rejeitar$/i })).toBeNull()
})


it('shows streamed command output immediately below the command event', () => {
  const session = legacySession()
  const timestamp = '2026-09-03T23:10:00.000Z'
  render(<Inspector
    config={{ planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }}
    session={session}
    events={[
      { id: 'evt-start', session_id: session.id, type: 'command.started', timestamp, data: { run_id: 'run-1', argv: ['go', 'test', './...'], cwd: '.', target: 'sandbox' } },
      { id: 'evt-output', session_id: session.id, type: 'command.output', timestamp, data: { run_id: 'run-1', stream: 'stdout', text: 'package ok\n', target: 'sandbox' } },
      { id: 'evt-done', session_id: session.id, type: 'command.completed', timestamp, data: { run_id: 'run-1', argv: ['go', 'test', './...'], exit_code: 0, success: true, stdout: 'package ok\n', target: 'sandbox' } },
    ]}
    manualPrompt=""
    busy={false}
    onChatGPTURL={() => true}
    onExecute={async () => undefined}
    onApply={async () => undefined}
    onManualPlan={async () => undefined}
    onPlanFile={async () => ''}
    onBundleFile={async () => ''}
    onSession={() => undefined}
  />)
  fireEvent.click(screen.getByRole('button', { name: /Execução/ }))
  const output = document.querySelector('.execution-command-output')
  expect(output?.textContent).toContain('package ok')
  expect(document.querySelectorAll('.execution-command-output')).toHaveLength(1)
  expect(document.querySelectorAll('.execution-command-card')).toHaveLength(1)
  expect(document.querySelector('.execution-log-panel')).toBeNull()
})

class TestResizeObserver { observe() {}; disconnect() {}; unobserve() {} }

function desktopBridge() {
  const noopSubscription = () => () => undefined
  const stateFor = (cacheKey: string) => ({ url: 'https://chatgpt.com/', title: 'ChatGPT', loading: false, canGoBack: false, canGoForward: false, authMode: 'embedded' as const, authWindowOpen: false, authenticated: false, cacheKey })
  return {
    platform: 'linux', projects: { pickDirectory: vi.fn() },
    chatgpt: {
      show: vi.fn().mockResolvedValue({ ok: true }), hide: vi.fn().mockResolvedValue({ ok: true }), setBounds: vi.fn().mockResolvedValue({ ok: true }),
      navigate: vi.fn((_url: string, cacheKey: string) => Promise.resolve(stateFor(cacheKey))), confirmAffinity: vi.fn(), rejectAffinity: vi.fn(), reload: vi.fn(), focus: vi.fn(), back: vi.fn(), forward: vi.fn(), paste: vi.fn(), submitPrompt: vi.fn(), preparePrompt: vi.fn(), attachContext: vi.fn(), attachPrompt: vi.fn(), submitPrepared: vi.fn(), continueExpectedBundle: vi.fn(), stopConversation: vi.fn(),
      state: vi.fn((cacheKey: string) => Promise.resolve(stateFor(cacheKey))), release: vi.fn(), setAuthMode: vi.fn(), startAuth: vi.fn(), openExternal: vi.fn(), resumeEmbedded: vi.fn(), pickBundle: vi.fn(),
      onState: vi.fn(noopSubscription), onExternalAuth: vi.fn(noopSubscription), onAuthComplete: vi.fn(noopSubscription), onAuthError: vi.fn(noopSubscription),
      onPlanDownloaded: vi.fn(noopSubscription), onPlanDownloadError: vi.fn(noopSubscription), onBundleDownloaded: vi.fn(noopSubscription), onBundleDownloadError: vi.fn(noopSubscription),
      onActivity: vi.fn(noopSubscription),
    },
    attachments: { persist: vi.fn(), preview: vi.fn(), open: vi.fn(), removeChat: vi.fn() }, clipboard: { copyContextZip: vi.fn(), readText: vi.fn(), writeText: vi.fn() },
  } as unknown as WharnessDesktopBridge
}

function workspaceChat(id: string, title: string): WorkspaceChat {
  return { id, title, sessionId: `ses-${id}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
}

describe('Inspector ChatGPT engine pool (desktop)', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', TestResizeObserver) })
  afterEach(() => { cleanup(); delete window.wharnessDesktop; vi.unstubAllGlobals() })

  it('keeps exactly one Supervisor pane while the active chat changes', async () => {
    const desktop = desktopBridge(); window.wharnessDesktop = desktop
    const chatA = workspaceChat('chat-a', 'Chat A')
    const chatB = workspaceChat('chat-b', 'Chat B')
    const sessionA = { ...legacySession(), id: chatA.sessionId }
    const sessionB = { ...legacySession(), id: chatB.sessionId }
    const props = {
      config: { planner: 'manual', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false } as const,
      events: [], manualPrompt: '', busy: false, chats: [chatA, chatB],
      onChatGPTURL: () => true, onExecute: async () => undefined, onApply: async () => undefined,
      onManualPlan: async () => undefined, onPlanFile: async () => '', onBundleFile: async () => '', onSession: () => undefined,
    }
    const view = render(<Inspector {...props} session={sessionA} chat={chatA} />)

    await waitFor(() => expect(document.querySelectorAll('.desktop-chatgpt-pool-item')).toHaveLength(1))
    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalledWith(expect.anything(), 'chat-a', expect.anything()))
    expect(desktop.chatgpt.state).toHaveBeenCalledTimes(1)

    act(() => { view.rerender(<Inspector {...props} session={sessionB} chat={chatB} />) })

    await waitFor(() => expect(desktop.chatgpt.show).toHaveBeenCalledWith(expect.anything(), 'chat-b', expect.anything()))
    expect(document.querySelectorAll('.desktop-chatgpt-pool-item')).toHaveLength(1)
    expect(desktop.chatgpt.state).toHaveBeenCalledTimes(1)
  })
})

describe('Inspector Manual chat transport mode', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', TestResizeObserver) })
  afterEach(() => { cleanup(); delete window.wharnessDesktop; vi.unstubAllGlobals() })

  function manualSession(): Session {
    return { ...legacySession(), chat_transport_mode: 'manual' }
  }

  it('shows the manual prompt/upload UI without requiring Desktop', () => {
    render(<Inspector
      config={{ planner: 'manual', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }}
      session={manualSession()}
      events={[]}
      manualPrompt="prompt para copiar"
      busy={false}
      activeTab="chatgpt"
      onChatGPTURL={() => true}
      onExecute={async () => undefined}
      onApply={async () => undefined}
      onManualPlan={async () => undefined}
      onPlanFile={async () => ''}
      onBundleFile={async () => ''}
      onSession={() => undefined}
    />)
    expect(screen.getByText('prompt para copiar')).toBeTruthy()
    expect(document.querySelector('.desktop-chatgpt-pool')).toBeNull()
    expect(screen.getByText('Manual (sem DOM)')).toBeTruthy()
  })

  it('never shows the active native ChatGPT view even when Desktop is present', async () => {
    const desktop = desktopBridge(); window.wharnessDesktop = desktop
    const chatA = workspaceChat('chat-a', 'Chat A')
    const session = { ...manualSession(), id: chatA.sessionId }
    render(<Inspector
      config={{ planner: 'manual', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }}
      session={session}
      events={[]}
      manualPrompt="prompt para copiar"
      busy={false}
      activeTab="chatgpt"
      chat={chatA}
      chats={[chatA]}
      onChatGPTURL={() => true}
      onExecute={async () => undefined}
      onApply={async () => undefined}
      onManualPlan={async () => undefined}
      onPlanFile={async () => ''}
      onBundleFile={async () => ''}
      onSession={() => undefined}
    />)
    expect(screen.getByText('prompt para copiar')).toBeTruthy()
    await waitFor(() => expect(desktop.chatgpt.hide).toHaveBeenCalledWith('chat-a'))
    expect(desktop.chatgpt.show).not.toHaveBeenCalled()
  })

  it('extracts the request id from an uploaded bundle filename and submits it, including a browser duplicate-suffix name', async () => {
    const requestId = 'req_20260906T192238_1adfea24039ba474'
    const onBundleFile = vi.fn<(contentBase64: string, requestId: string, filename: string) => Promise<string>>(async () => 'Bundle importado com sucesso')
    render(<Inspector
      config={{ planner: 'manual', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }}
      session={manualSession()}
      events={[]}
      manualPrompt=""
      busy={false}
      activeTab="chatgpt"
      onChatGPTURL={() => true}
      onExecute={async () => undefined}
      onApply={async () => undefined}
      onManualPlan={async () => undefined}
      onPlanFile={async () => ''}
      onBundleFile={onBundleFile}
      onSession={() => undefined}
    />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeTruthy()
    const filename = `whx_bundle_res_9f3a2b1c-uuid-like_${requestId} (2).zip`
    const file = new File(['zip-bytes'], filename, { type: 'application/zip' })
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(onBundleFile).toHaveBeenCalledTimes(1))
    const [contentBase64, calledRequestId, calledFilename] = onBundleFile.mock.calls[0]
    expect(calledRequestId).toBe(requestId)
    expect(calledFilename).toBe(filename)
    expect(typeof contentBase64).toBe('string')
    expect(contentBase64.length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getByText('Bundle importado com sucesso')).toBeTruthy())
  })

  it('rejects an unrecognized filename without calling onBundleFile', async () => {
    const onBundleFile = vi.fn(async () => '')
    render(<Inspector
      config={{ planner: 'manual', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false }}
      session={manualSession()}
      events={[]}
      manualPrompt=""
      busy={false}
      activeTab="chatgpt"
      onChatGPTURL={() => true}
      onExecute={async () => undefined}
      onApply={async () => undefined}
      onManualPlan={async () => undefined}
      onPlanFile={async () => ''}
      onBundleFile={onBundleFile}
      onSession={() => undefined}
    />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['zip-bytes'], 'result.zip', { type: 'application/zip' })
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(onBundleFile).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText(/Nome de ficheiro não reconhecido/)).toBeTruthy())
  })
})
