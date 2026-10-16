import { Icon } from '../../../presentation/chrome/Icon'
import { StatusBadge } from '../../../presentation/workbench'

export function MonitorLocation({ url, loading, label }: { url?: string; loading?: boolean; label?: string }) {
  return <div className="flex min-h-11 shrink-0 items-center gap-3 border-b border-whx-border-soft bg-whx-surface px-3 text-whx-caption">
    <Icon name="link" size={15}/><span className="min-w-0 flex-1 truncate font-mono text-whx-soft" title={url}>{url || 'Nenhuma página carregada'}</span>
    <StatusBadge tone={loading ? 'info' : 'neutral'}>{loading ? 'A carregar…' : label || 'Navegador'}</StatusBadge>
  </div>
}
