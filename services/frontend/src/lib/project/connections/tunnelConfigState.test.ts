import { describe, expect, it } from 'vitest'
import type { AppConfig } from '../../../types'
import { reconcileTunnelConfig } from './tunnelConfigState'

describe('reconcileTunnelConfig', () => {
  it('removes deleted daemon instances from the open workspace and its next bundle', () => {
    const current: AppConfig = {
      planner: 'manual', sandbox: 'docker', model: '', api_configured: false, chatgpt_web_embed: false,
      remote_input: {
        enabled: true, provider: 'pool', mode: 'tunnel',
        instances: [tunnel('removed'), tunnel('active')],
      },
    }

    const next = reconcileTunnelConfig(current, {
      version: 1, instance_name: 'Oficina', instances: [{ id: 'active', provider: 'trycloudflare', priority: 10 }],
    })

    expect(next?.remote_input?.instances?.map((instance) => instance.id)).toEqual(['active'])
  })

  it('falls back to local attachments when every tunnel was removed', () => {
    const current: AppConfig = {
      planner: 'manual', sandbox: 'docker', model: '', api_configured: false, chatgpt_web_embed: false,
      remote_input: { enabled: true, provider: 'trycloudflare', mode: 'tunnel', instances: [tunnel('removed')] },
    }

    const next = reconcileTunnelConfig(current, { version: 1, instance_name: 'Oficina', instances: [] })

    expect(next?.remote_input).toMatchObject({ enabled: false, mode: 'local_attachments', instances: [] })
    expect(next?.remote_input?.provider).toBeUndefined()
  })
})

function tunnel(id: string): NonNullable<NonNullable<AppConfig['remote_input']>['instances']>[number] {
  return {
    id, provider: 'trycloudflare', priority: 10, available: true,
    limits: { max_requests: 0, window_seconds: 0, max_files_per_input: 0, max_file_bytes: 0, max_input_bytes: 0, max_stored_objects: 0, max_storage_bytes: 0 },
    usage: { requests_in_window: 0, stored_objects: 0, storage_bytes: 0 },
  }
}
