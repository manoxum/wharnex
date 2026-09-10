import { describe, expect, it } from 'vitest'
import {
  CHAT_NAMING_ATTEMPT_CAP,
  REMOTE_ARCHIVE_ATTEMPT_CAP,
  dueChatNaming,
  dueRemoteArchives,
  duePurgeChatIds,
  isProvisionallyNamed,
  parseWharnexBundleName,
  purgeableLibraryEntry,
  retryBackoffMs,
} from './chatMaintenance'
import type { WorkspaceChat } from './workspaceMemory'

const NOW = Date.parse('2026-09-09T21:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

function chat(overrides: Partial<WorkspaceChat> = {}): WorkspaceChat {
  return {
    id: 'cdbd0525-425f-404e-b547-bd934160b7d0',
    title: 'Novo chat',
    sessionId: 'session-1',
    createdAt: ago(86_400_000),
    updatedAt: ago(86_400_000),
    ...overrides,
  }
}

describe('remote archive retry job', () => {
  it('selects an archived chat whose remote archive was never confirmed', () => {
    const pending = chat({ chatgptUrl: 'https://chatgpt.com/c/abc', remoteArchive: { state: 'pending', attempts: 1, lastAttemptAt: ago(60 * 60_000) } })
    expect(dueRemoteArchives([pending], NOW)).toHaveLength(1)
  })

  it('ignores chats whose remote archive already succeeded or never applied', () => {
    const done = chat({ id: 'a', chatgptUrl: 'https://chatgpt.com/c/a', remoteArchive: { state: 'archived', attempts: 1 } })
    const local = chat({ id: 'b', remoteArchive: { state: 'not-applicable', attempts: 0 } })
    expect(dueRemoteArchives([done, local], NOW)).toEqual([])
  })

  // A chat with no bound conversation has nothing to archive remotely; retrying
  // it forever would burn the job budget on an impossible operation.
  it('ignores a pending chat with no bound conversation', () => {
    const unbound = chat({ remoteArchive: { state: 'pending', attempts: 0 } })
    expect(dueRemoteArchives([unbound], NOW)).toEqual([])
  })

  it('honours exponential backoff between attempts', () => {
    const justTried = chat({ chatgptUrl: 'https://chatgpt.com/c/abc', remoteArchive: { state: 'pending', attempts: 3, lastAttemptAt: ago(60_000) } })
    expect(dueRemoteArchives([justTried], NOW)).toEqual([])
    const waited = chat({ chatgptUrl: 'https://chatgpt.com/c/abc', remoteArchive: { state: 'pending', attempts: 3, lastAttemptAt: ago(3 * 60 * 60_000) } })
    expect(dueRemoteArchives([waited], NOW)).toHaveLength(1)
  })

  it('stops retrying after the attempt cap', () => {
    const exhausted = chat({ chatgptUrl: 'https://chatgpt.com/c/abc', remoteArchive: { state: 'pending', attempts: REMOTE_ARCHIVE_ATTEMPT_CAP, lastAttemptAt: ago(30 * 24 * 60 * 60_000) } })
    expect(dueRemoteArchives([exhausted], NOW)).toEqual([])
  })

  it('caps the backoff so a parked chat is still retried periodically', () => {
    expect(retryBackoffMs(1)).toBe(5 * 60_000)
    expect(retryBackoffMs(3)).toBe(20 * 60_000)
    expect(retryBackoffMs(20)).toBe(6 * 60 * 60_000)
    expect(retryBackoffMs(0)).toBe(0)
  })
})

describe('chat naming job', () => {
  it('selects a bound chat that still carries a provisional title', () => {
    const provisional = chat({ chatgptUrl: 'https://chatgpt.com/c/abc' })
    expect(dueChatNaming([provisional], NOW)).toHaveLength(1)
  })

  // A title the user typed is theirs. The job must never overwrite it.
  it('never revisits a definitive title', () => {
    const named = chat({ chatgptUrl: 'https://chatgpt.com/c/abc', title: 'Corrigir fila', naming: { state: 'definitive', attempts: 1 } })
    expect(isProvisionallyNamed(named)).toBe(false)
    expect(dueChatNaming([named], NOW)).toEqual([])
  })

  it('gives up after the attempt cap so an unnameable chat stops consuming the budget', () => {
    const exhausted = chat({ chatgptUrl: 'https://chatgpt.com/c/abc', naming: { state: 'unavailable', attempts: CHAT_NAMING_ATTEMPT_CAP, lastAttemptAt: ago(30 * 24 * 60 * 60_000) } })
    expect(dueChatNaming([exhausted], NOW)).toEqual([])
  })

  it('skips a chat with no bound conversation to read a title from', () => {
    expect(dueChatNaming([chat()], NOW)).toEqual([])
  })
})

describe('library purge job', () => {
  it('selects chats archived beyond the three-day retention window', () => {
    const old = chat({ id: 'old', archivedAt: ago(4 * 24 * 60 * 60_000) })
    const recent = chat({ id: 'recent', archivedAt: ago(2 * 24 * 60 * 60_000) })
    expect(duePurgeChatIds([old, recent], NOW)).toEqual(['old'])
  })

  it('ignores an archived chat with no usable archive timestamp', () => {
    expect(duePurgeChatIds([chat({ archivedAt: 'not-a-date' })], NOW)).toEqual([])
  })

  // Ownership is proven by the naming contract, never assumed. Anything that is
  // not a Wharnex bundle for an expired chat stays untouched in the account.
  it('only authorizes deletion of Wharnex bundles owned by an expired chat', () => {
    const expired = ['cdbd0525-425f-404e-b547-bd934160b7d0']
    expect(purgeableLibraryEntry('whx_bundle_req_cdbd0525-425f-404e-b547-bd934160b7d0_req_20260909T214310_c6e73081cec5f82f.zip', expired)).toBe(true)
    expect(purgeableLibraryEntry('whx_bundle_res_cdbd0525-425f-404e-b547-bd934160b7d0_req_20260909T211149_7c9370a2fc0ad08e_req_20260909T213929_e5e13ca8c88a374c.zip', expired)).toBe(true)
    expect(purgeableLibraryEntry('whx_bundle_req_736cc2e8-d0c5-442f-9508-bd30639372df_req_20260909T214314_236b6a8ef5637591.zip', expired)).toBe(false)
    expect(purgeableLibraryEntry('relatorio-pessoal.pdf', expired)).toBe(false)
    expect(purgeableLibraryEntry('whx_bundle_req_x_notarequestid.zip', expired)).toBe(false)
  })

  it('parses the bundle naming contract that proves ownership', () => {
    expect(parseWharnexBundleName('whx_bundle_req_chat-1_req_20260909T214310_c6e73081cec5f82f.zip')).toEqual({
      kind: 'req', chatId: 'chat-1', requestId: 'req_20260909T214310_c6e73081cec5f82f', subrequestId: '',
    })
    expect(parseWharnexBundleName('arbitrary.zip')).toBeNull()
  })
})
