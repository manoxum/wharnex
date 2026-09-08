import type { CSSProperties } from 'react'
import { instanceHue } from './instanceBadgeHue'

export function InstanceBadge({ instanceID }: { instanceID?: string }) {
  const name = instanceID?.trim()
  if (!name) return null
  const style = { '--instance-hue': `${instanceHue(name)}deg` } as CSSProperties
  return <span className="instance-badge" style={style} aria-label={`Instância: ${name}`} title={`Instância em execução: ${name}`}>
    <span className="instance-badge-dot" aria-hidden="true" />
    {name}
  </span>
}
