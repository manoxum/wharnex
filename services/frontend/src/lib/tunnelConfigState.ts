import type { AppConfig, TunnelProviderDocument } from '../types'

// The daemon intentionally keeps its process pool stable until restart, while
// the saved document is authoritative for what new requests may discover and
// publish. Reconcile the already-loaded App config immediately after a save so
// a removed runtime tunnel cannot remain selectable in the open workspace.
export function reconcileTunnelConfig(current: AppConfig | undefined, document: TunnelProviderDocument): AppConfig | undefined {
  if (!current?.remote_input) return current
  const configured = new Set(document.instances.map((instance) => instance.id))
  const instances = (current.remote_input.instances || []).filter((instance) => configured.has(instance.id))
  return {
    ...current,
    remote_input: {
      ...current.remote_input,
      enabled: instances.length > 0,
      provider: instances.length > 0 ? current.remote_input.provider : undefined,
      mode: instances.length > 0 ? current.remote_input.mode : 'local_attachments',
      instances,
    },
  }
}
