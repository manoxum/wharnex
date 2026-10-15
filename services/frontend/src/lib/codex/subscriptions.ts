import { desktopBridge } from '../desktop/bridge/desktop'

const subscriptions = new Map<string, { count: number; ready: Promise<unknown> }>()
export function subscribeCodexProject(projectPath: string) {
  const bridge = desktopBridge()?.codex
  if (!bridge) return { ready: Promise.resolve(), release: () => {} }
  let subscription = subscriptions.get(projectPath)
  if (!subscription) {
    subscription = { count: 0, ready: bridge.subscribe(projectPath) }
    subscriptions.set(projectPath, subscription)
  }
  subscription.count++
  let released = false
  return { ready: subscription.ready, release: () => {
    if (released) return
    released = true
    if (--subscription.count === 0) {
      subscriptions.delete(projectPath)
      void subscription.ready.then(() => bridge.unsubscribe(projectPath)).catch(() => {})
    }
  } }
}
