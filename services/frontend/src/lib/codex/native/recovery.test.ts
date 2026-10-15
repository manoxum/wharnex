import { expect, it } from 'vitest'
import type { CodexThread } from '../contracts'
import { canResumeNative } from './recovery'

it('native attention always offers recovery without exposing replay for live, completed or legacy planner work', () => {
  const thread: CodexThread = { native: true, status: 'attention', projectPath: '/project', chatId: 'chat', requestId: 'req', threadId: 'thread', title: 'Work', error: '', messages: [], tokenUsage: null }
  expect(canResumeNative(thread)).toBe(true)
  expect(canResumeNative({ ...thread, resumeAvailable: false })).toBe(true)
  expect(canResumeNative({ ...thread, native: false })).toBe(false)
  for (const status of ['running', 'submitting', 'waiting', 'ready', 'completed'] as const) expect(canResumeNative({ ...thread, status, resumeAvailable: true })).toBe(false)
  expect(canResumeNative({ ...thread, status: 'idle' })).toBe(false)
  expect(canResumeNative({ ...thread, status: 'idle', resumeAvailable: true })).toBe(true)
})
