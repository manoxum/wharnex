import { useEffect, useRef } from 'react'
import { desktopBridge } from '../../lib/desktop/bridge/desktop'
import { shouldPublishNativeAttentionAfterBaseline } from '../../lib/orchestrator'
import type { AttentionItem } from '../../lib/attention'

export function useCompletionNotifications(projectPath: string, attentionItems: AttentionItem[]) {
  const nativeCompletionBaselineRef = useRef(Date.now())
  const nativeNotificationIdsRef = useRef(new Set<string>())
  useEffect(() => {
    const notifications = desktopBridge()?.notifications
    if (!notifications || !projectPath) return
    for (const entry of attentionItems) {
      if (!entry.kind || !entry.occurredAt || nativeNotificationIdsRef.current.has(entry.id)) continue
      nativeNotificationIdsRef.current.add(entry.id)
      if (!shouldPublishNativeAttentionAfterBaseline(entry, nativeCompletionBaselineRef.current)) continue
      void notifications.publish({
        id: entry.id,
        projectPath,
        chatId: entry.chatId,
        kind: entry.kind,
        title: entry.title,
        body: entry.detail,
        occurredAt: entry.occurredAt,
      }).catch(() => undefined)
    }
  }, [attentionItems, projectPath])
}
