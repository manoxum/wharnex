import { describe, expect, it } from 'vitest'
import type { GitConflictContext, IntegrationConflict, Session } from '../types'
import { conflictAutoDispatchable, gitConflictChatTitle } from './gitConflictChat'

const git: GitConflictContext = { origin: 'remote_branch_merge', ref: 'origin/feat/x', base_sha: 'b', ours_sha: 'o', theirs_sha: 't', target_branch: 'origin/main' }
const conflict = (extra: Partial<IntegrationConflict> = {}): IntegrationConflict => ({ id: 'c', request_id: 'r', original_plan_ids: [], paths: ['CHANGELOG.md'], details: [], created_at: '', ...extra })
const session = (integration_conflict?: IntegrationConflict) => ({ integration_conflict } as Session)

describe('conflictAutoDispatchable', () => {
  it('keeps integration conflicts automatic', () => {
    expect(conflictAutoDispatchable(session(conflict()))).toBe(true)
  })

  it('holds a freshly detected Git conflict for the operator choice', () => {
    expect(conflictAutoDispatchable(session(conflict({ git })))).toBe(false)
  })

  it('sends a Git conflict once the backend marked it for dispatch', () => {
    expect(conflictAutoDispatchable(session(conflict({ git: { ...git, auto_dispatch: true } })))).toBe(true)
  })
})

describe('gitConflictChatTitle', () => {
  it('names the dedicated chat after the incoming ref', () => {
    expect(gitConflictChatTitle(session(conflict({ git })))).toBe('Conflito Git · origin/feat/x')
  })
})
