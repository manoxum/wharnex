import { useEffect, type MutableRefObject } from 'react'
import { desktopBridge } from '../desktop/bridge/desktop'
import { createBundleInboxDelivery } from '../../app/transport/delivery/inbox'
import { subscribeCodexProject } from './subscriptions'
import type { ValidatedBundleSubmit } from './bundleDelivery'

export function useCodexInbox(projectPath: string | undefined, routingReady: string, submit: MutableRefObject<ValidatedBundleSubmit>, onError: (message: string) => void) {
  useEffect(() => {
    const codex = desktopBridge()?.codex
    if (!codex || !projectPath || !routingReady) return
    const subscription = subscribeCodexProject(projectPath)
    const ingest = createBundleInboxDelivery({
      submit: (bundle) => submit.current(bundle.contentBase64, bundle.requestId, bundle.filename, () => codex.acknowledge(projectPath, bundle.cacheKey || '', bundle.requestId)),
      acknowledge: async () => {},
      retain: async () => {}, accepted: () => {},
      failed: (_bundle, error) => onError(error instanceof Error ? error.message : 'Não foi possível validar o bundle Codex.'),
    })
    let alive = true
    const unsubscribe = codex.onBundle((bundle) => { if (alive && bundle.projectPath === projectPath) void ingest(bundle) })
    void subscription.ready.then(() => codex.pendingBundles(projectPath)).then((bundles) => {
      if (alive) for (const bundle of bundles) void ingest(bundle)
    }).catch((error) => { if (alive) onError(error instanceof Error ? error.message : 'Falha ao recuperar bundles Codex.') })
    return () => { alive = false; unsubscribe(); subscription.release() }
  }, [projectPath, routingReady, submit, onError])
}
