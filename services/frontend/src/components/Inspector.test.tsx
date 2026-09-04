import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Session } from '../types'
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
