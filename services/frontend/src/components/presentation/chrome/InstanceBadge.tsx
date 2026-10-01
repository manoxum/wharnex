import type { CSSProperties } from 'react'
import { instanceHue } from './instanceBadgeHue'

export function InstanceBadge({ instanceID, version }: { instanceID?: string; version?: string }) {
  const name = instanceID?.trim()
  const release = version?.trim()
  if (!name) return null
  const style = { '--instance-hue': `${instanceHue(name)}deg` } as CSSProperties
  const label = release ? `Instância: ${name} · versão ${release}` : `Instância: ${name}`
  const title = release ? `Instância em execução: ${name} · versão ${release}` : `Instância em execução: ${name}`
  return <span className="instance-badge" style={style} aria-label={label} title={title}>
    <span className="instance-badge-dot" aria-hidden="true" />
    {name}{release && <> · {release}</>}
  </span>
}
