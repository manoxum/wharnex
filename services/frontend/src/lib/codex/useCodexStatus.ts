import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { desktopBridge } from '../desktop/bridge/desktop'
import { subscribeCodexProject } from './subscriptions'
import type { CodexStatus, CodexThread } from './contracts'

type Snapshot = { data?: CodexStatus; threads?: CodexThread[]; error: string; loading: boolean }
type Resource = { snapshot: Snapshot; listeners: Set<() => void>; pending?: Promise<void>; accountChanged?: boolean }
const resources = new Map<string, Resource>()
function resource(projectPath: string) {
  let value = resources.get(projectPath)
  if (!value) { value = { snapshot: { error: '', loading: false }, listeners: new Set() }; resources.set(projectPath, value) }
  return value
}
function publish(value: Resource, snapshot: Snapshot) {
  value.snapshot = snapshot
  for (const listener of value.listeners) listener()
}
export async function refreshCodexStatus(projectPath: string) {
  const value = resource(projectPath)
  if (value.pending) return value.pending
  const codex = desktopBridge()?.codex
  if (!codex) { publish(value, { error: 'O Codex integrado requer o Wharnex Desktop atualizado.', loading: false }); return }
  const initialThreads = value.snapshot.threads || []
  publish(value, { ...value.snapshot, loading: true, error: '' })
  value.pending = codex.status(projectPath).then((data) => {
    const live = (value.snapshot.threads || []).filter((thread) => !initialThreads.includes(thread))
    const threads = [...data.threads.filter((thread) => !live.some((item) => item.chatId === thread.chatId)), ...live]
    publish(value, { data: { ...data, threads }, threads, loading: false, error: '' })
  })
    .catch((error: unknown) => publish(value, { ...value.snapshot, loading: false, error: error instanceof Error ? error.message : 'Não foi possível ligar ao Codex.' }))
    .finally(() => { value.pending = undefined; if (value.accountChanged) { value.accountChanged = false; void refreshCodexStatus(projectPath) } })
  return value.pending
}
export function useCodexStatus(projectPath: string, enabled = true) {
  const subscribe = useCallback((listener: () => void) => {
    const value = resource(projectPath); value.listeners.add(listener)
    return () => { value.listeners.delete(listener) }
  }, [projectPath])
  const snapshot = useSyncExternalStore(subscribe, () => resource(projectPath).snapshot)
  useEffect(() => {
    if (!enabled) return
    const value = resource(projectPath)
    const subscription = subscribeCodexProject(projectPath)
    const onEvent = (thread: CodexThread) => {
      if (thread.projectPath !== projectPath) return
      const threads = [...(value.snapshot.threads || value.snapshot.data?.threads || []).filter((item) => item.chatId !== thread.chatId), thread]
      publish(value, { ...value.snapshot, threads, ...(value.snapshot.data ? { data: { ...value.snapshot.data, threads } } : {}) })
    }
    const unsubscribe = desktopBridge()?.codex?.onEvent(onEvent)
    const unsubscribeAccount = desktopBridge()?.codex?.onAccountChange?.(() => { if (value.pending) value.accountChanged = true; else void refreshCodexStatus(projectPath) })
    void subscription.ready.then(() => refreshCodexStatus(projectPath)).catch(() => {})
    const timer = window.setInterval(() => { void refreshCodexStatus(projectPath) }, 60_000)
    return () => { unsubscribe?.(); unsubscribeAccount?.(); subscription.release(); window.clearInterval(timer) }
  }, [projectPath, enabled])
  return { ...snapshot, refresh: () => refreshCodexStatus(projectPath) }
}
