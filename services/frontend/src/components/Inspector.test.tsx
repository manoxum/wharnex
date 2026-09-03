import { render, screen } from '@testing-library/react'
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
      onChatGPTURL={() => undefined}
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
