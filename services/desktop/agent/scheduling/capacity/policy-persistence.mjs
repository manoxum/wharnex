import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_SUSPENDED_WORKER_TASK_TYPES, normalizeChatAgentPolicies } from './chat-agent-policies.mjs'

// The v1 filename is persisted user state; only its internal owner changes.
export function createChatAgentPolicyStore({ userDataPath, policies, warn = console.warn }) {
  const filePath = () => path.join(userDataPath(), 'chat-agent-policies-v1.json')

  function load() {
    try {
      const stored = JSON.parse(readFileSync(filePath(), 'utf8'))
      if (Number(stored?.version || 0) < 2) {
        return normalizeChatAgentPolicies({
          ...stored,
          workers_suspended: true,
          workers_suspended_until: '',
          workers_suspended_types: DEFAULT_SUSPENDED_WORKER_TASK_TYPES,
        })
      }
      return normalizeChatAgentPolicies(stored)
    } catch { return normalizeChatAgentPolicies() }
  }

  function persist() {
    try {
      writeFileSync(filePath(), `${JSON.stringify({ version: 2, ...policies() }, null, 2)}\n`, { mode: 0o600 })
    } catch (error) { warn('[chat-agent] policy persistence failed', error) }
  }

  return { load, persist }
}
