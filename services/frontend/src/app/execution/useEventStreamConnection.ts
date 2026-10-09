import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ChatItem, HarnessEvent, Session } from '../../types'
import type { WorkspaceChat } from '../../lib/chat/history/workspaceMemory'
import { loadExecutionHistory, loadWorkspaceChats, saveExecutionHistory } from '../../lib/chat/history/workspaceMemory'
import { api } from '../../lib/transport/http/api'
import type { LiveEventStream } from '../../lib/transport/http/liveEventStream'
import { openSessionEvents } from '../../lib/transport/http/sessionEvents'
import { createEventStreamCoalescer, type EventStreamCoalescer } from '../../lib/transport/http/eventStream'
import { executionStartedNotice } from '../../lib/execution/history/executionNotice'
import { finishExecutionQueueItem, upsertExecutionQueueItem, type ExecutionFIFOItem } from '../../lib/execution/history/executionQueueView'

const EXECUTION_ACTIVE_EVENT_TYPES = new Set(['execution.queued', 'execution.dequeued', 'execution.started'])
const EXECUTION_TERMINAL_EVENT_TYPES = new Set(['execution.completed', 'execution.failed', 'execution.duplicate_blocked'])

type Params = {
  sourceRef: MutableRefObject<LiveEventStream | null>
  coalescerRef: MutableRefObject<EventStreamCoalescer | undefined>
  sessionCacheRef: MutableRefObject<Record<string, Session>>
  activeChatIdRef: MutableRefObject<string>
  setEvents: Dispatch<SetStateAction<HarnessEvent[]>>
  setSession: Dispatch<SetStateAction<Session | undefined>>
  setHostAppliedPresentation: Dispatch<SetStateAction<{ eventId: string; sessionId: string; projectPath: string; chatId: string } | undefined>>
  setExecutionFIFO: Dispatch<SetStateAction<ExecutionFIFOItem[]>>
  appendChatItem: (targetChat: WorkspaceChat, projectPath: string, item: ChatItem) => void
}

export function useEventStreamConnection({ sourceRef, coalescerRef, sessionCacheRef, activeChatIdRef, setEvents, setSession, setHostAppliedPresentation, setExecutionFIFO, appendChatItem }: Params) {
  return useCallback((id: string, projectPath: string, chatId: string) => {
    sourceRef.current?.close()
    coalescerRef.current?.dispose()
    const restored = loadExecutionHistory(projectPath, chatId)
    setEvents(restored)

    const source = openSessionEvents(api.eventsURL(id))
    const coalescer = createEventStreamCoalescer({
      restored,
      // A timer that outlives its stream must not write another chat's window;
      // every disconnect path replaces or clears `sourceRef`, so that identity
      // is the authority on whether this stream is still the live one.
      isCurrent: () => sourceRef.current === source,
      onPersist: (eventWindow) => saveExecutionHistory(projectPath, chatId, eventWindow),
      onFlush: (batch, eventWindow) => {
        // One workspace-chat read for the whole batch, not two per frame.
        const needsOwner = batch.some((parsed) => parsed.type === 'workspace_chat.item_upserted' || parsed.type === 'execution.started' || (parsed.data.plan_id && EXECUTION_ACTIVE_EVENT_TYPES.has(parsed.type)))
        const owner = needsOwner ? loadWorkspaceChats(projectPath).find((chat) => chat.id === chatId) : undefined
        const transcriptUpdates = new Set(batch.filter((parsed) => parsed.type === 'workspace_chat.item_upserted' && parsed.data.chat_id === chatId).map((parsed) => String((parsed.data.item as ChatItem | undefined)?.id || '')))
        if (owner && transcriptUpdates.size) {
          // Audit frames are bounded/redacted notifications. Read the durable
          // payload before projecting it, so a long prompt is not truncated.
          void api.workspaceChatItems(chatId).then(({ items }) => {
            if (sourceRef.current !== source) return
            for (const entry of items) {
              if (entry.chat_id === chatId && transcriptUpdates.has(entry.id)) appendChatItem(owner, projectPath, entry.payload)
            }
          }).catch(() => undefined)
        }
        const sessionMutationEvents = new Set(['plan.received', 'plan.control_changed', 'plan.reversal_requested', 'repair.prompt_ready', 'baseline.continuation_ready', 'conflict.prompt_ready', 'git.conflict_obsolete', 'conflict.bundle_obsolete', 'host.applied', 'host.apply_settled', 'host.apply_paused', 'automation.paused', 'host.reverted', 'host.restored'])
        if (batch.some((parsed) => (parsed.type === 'artifact.persisted' && parsed.data.kind === 'bundle') || sessionMutationEvents.has(parsed.type))) {
          void api.getSession(id).then((updated) => {
            sessionCacheRef.current[chatId] = updated
            if (activeChatIdRef.current === chatId) setSession(updated)
          }).catch(() => undefined)
        }
        for (const parsed of batch) {
          if (parsed.type === 'host.applied' || parsed.type === 'host.apply_settled') setHostAppliedPresentation({ eventId: parsed.id, sessionId: id, projectPath, chatId })
          if (parsed.type === 'execution.started' && owner) appendChatItem(owner, projectPath, executionStartedNotice(parsed))
          const planId = String(parsed.data.plan_id || '')
          if (!planId) continue
          if (EXECUTION_ACTIVE_EVENT_TYPES.has(parsed.type)) {
            const status: ExecutionFIFOItem['status'] = parsed.type === 'execution.queued' ? 'queued' : 'running'
            setExecutionFIFO((current) => {
              const key = `${id}:${planId}`
              const existing = current.find((item) => item.key === key)
              const next: ExecutionFIFOItem = { key, chatId, chatTitle: owner?.title || 'Harness Chat', planId, status, position: Number(parsed.data.position) || existing?.position, addedAt: existing?.addedAt || Date.now() }
              return upsertExecutionQueueItem(current, next)
            })
          } else if (EXECUTION_TERMINAL_EVENT_TYPES.has(parsed.type)) {
            const terminalStatus = parsed.type === 'execution.completed' ? 'completed' : 'failed'
            setExecutionFIFO((current) => finishExecutionQueueItem(current, `${id}:${planId}`, terminalStatus))
          }
        }
        setEvents(eventWindow)
      },
    })
    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as HarnessEvent
        if (parsed.type !== 'git.changed') coalescer.accept(parsed)
      }
      catch { /* ignore malformed stream frame */ }
    }
    coalescerRef.current = coalescer
    sourceRef.current = source
  }, [])

}
