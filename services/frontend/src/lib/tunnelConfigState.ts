import type { AppConfig, TunnelProviderDocument } from '../types'

// A runtime refresh normally supplies the newly adopted pool after a save.
// This fallback reconciles an already-loaded App config when that refresh is
// unavailable, so a removed tunnel cannot remain selectable in the workspace.
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
