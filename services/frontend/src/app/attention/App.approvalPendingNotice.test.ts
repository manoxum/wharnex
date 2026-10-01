import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/app/workspace/App.tsx'), 'utf8')

describe('App bundle-submission approval-pending notice', () => {
  it('keys the pending-approval state off structured session state, never auto_error prose', () => {
    expect(source).toMatch(/const pendingApproval = Boolean\(submission\.auto_error && \(\(updated\.policy\?\.allowed && updated\.policy\?\.requires_approval\) \|\| updated\.failure_kind === 'offline_go_module_cache'\)\)/)
  })

  it('renders the pending-approval pause as a wharness notice, not a chatgpt message or a chat error', () => {
    expect(source).toMatch(/plannerFailed \|\| submission\.policy_blocked \|\| submission\.workflow_executed \|\| pendingApproval \? 'wharness' : 'chatgpt'/)
    expect(source).toMatch(/submission\.policy_blocked \|\| submission\.workflow_executed \|\| pendingApproval \? 'notice' : 'message'/)
  })

  it('does not duplicate the pause as a chat error when it is only awaiting approval', () => {
    expect(source).toMatch(/if \(submission\.auto_error && !pendingApproval\) reportChatError\(/)
  })
})
