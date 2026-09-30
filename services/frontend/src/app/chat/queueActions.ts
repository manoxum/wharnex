import type { Dispatch, SetStateAction } from 'react'
import type { ChatArtifactSelection, ChatRequestMode, QueuedChatRequest } from '../../types'
import { addChatAttachments } from '../../lib/chat/attachments/chatAttachments'

type QueueState = Record<string, QueuedChatRequest[]>
type Params = {
  activeChatId: string
  setQueuedRequestsByChat: Dispatch<SetStateAction<QueueState>>
  setError: Dispatch<SetStateAction<string | undefined>>
}

export function createQueueActions({ activeChatId, setQueuedRequestsByChat, setError }: Params) {
  function enqueueMainRequest(message: string, attachments: File[], projectFiles: string[], artifacts: ChatArtifactSelection, requestMode: ChatRequestMode = 'direct') {
    if (!activeChatId) return Promise.resolve()
    const queued: QueuedChatRequest = { id: crypto.randomUUID(), message, attachments, projectFiles, artifacts: { ...artifacts }, requestMode, createdAt: new Date().toISOString() }
    setQueuedRequestsByChat((current) => ({ ...current, [activeChatId]: [...(current[activeChatId] || []), queued] }))
    return Promise.resolve()
  }

  function updateQueuedRequest(id: string, message: string) {
    setQueuedRequestsByChat((current) => ({ ...current, [activeChatId]: (current[activeChatId] || []).map((item) => item.id === id ? { ...item, message } : item) }))
  }

  function moveQueuedRequest(id: string, direction: -1 | 1) {
    setQueuedRequestsByChat((current) => {
      const queue = [...(current[activeChatId] || [])]
      const index = queue.findIndex((item) => item.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= queue.length) return current
      ;[queue[index], queue[target]] = [queue[target], queue[index]]
      return { ...current, [activeChatId]: queue }
    })
  }

  function removeQueuedRequest(id: string) {
    setQueuedRequestsByChat((current) => ({ ...current, [activeChatId]: (current[activeChatId] || []).filter((item) => item.id !== id) }))
  }

  function mergeQueuedRequest(id: string) {
    setQueuedRequestsByChat((current) => {
      const queue = [...(current[activeChatId] || [])]
      const index = queue.findIndex((item) => item.id === id)
      if (index < 0 || index >= queue.length - 1) return current
      const first = queue[index]
      const second = queue[index + 1]
      const mergedAttachments = addChatAttachments(first.attachments, second.attachments)
      if (mergedAttachments.error) { setError(`Não foi possível mesclar as requests: ${mergedAttachments.error}`); return current }
      const artifacts: ChatArtifactSelection = {
        context: first.artifacts.context || second.artifacts.context,
        prompt: first.artifacts.prompt || second.artifacts.prompt,
        result: first.artifacts.result || second.artifacts.result,
        error: first.artifacts.error || second.artifacts.error,
      }
      queue.splice(index, 2, { ...first, message: `${first.message}\n\n${second.message}`, attachments: mergedAttachments.files, projectFiles: [...new Set([...first.projectFiles, ...second.projectFiles])], artifacts })
      return { ...current, [activeChatId]: queue }
    })
  }

  return { enqueueMainRequest, updateQueuedRequest, moveQueuedRequest, removeQueuedRequest, mergeQueuedRequest }
}
