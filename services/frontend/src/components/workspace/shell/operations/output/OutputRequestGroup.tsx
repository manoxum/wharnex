import { useState } from 'react'
import { translate as uiText } from '../../../../../lib/workspace/localization'
import { Icon } from '../../../../presentation/chrome/Icon'
import { OutputEntry } from './OutputEntry'
import { formatDuration } from './outputFormat'
import type { OutputGroup } from './outputGroups'

export function OutputRequestGroup({ group }: { group: OutputGroup }) {
  const [open, setOpen] = useState(false)
  return <details className="group border-b border-whx-border-soft/70 bg-whx-side/40" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-3 text-whx-label outline-none hover:bg-whx-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-whx-accent [&::-webkit-details-marker]:hidden">
      <span className="shrink-0 transition-transform group-open:rotate-90"><Icon name="chevron-right" size={13}/></span>
      <strong className="min-w-0 flex-1 truncate font-medium" title={group.requestId}>{uiText('Pedido')} · {group.requestId}</strong>
      <span className="max-w-[55%] shrink-0 truncate text-whx-faint" title={`${group.entries.length} ${uiText('eventos')} · ${group.commands} ${uiText('comandos')} · ${group.errors} ${uiText('erros')}`}>
        {group.entries.length} {uiText('eventos')} · {group.commands} {uiText(group.commands === 1 ? 'comando' : 'comandos')}{group.errors ? ` · ${group.errors} ${uiText(group.errors === 1 ? 'erro' : 'erros')}` : ''}{group.durationMs ? ` · ${formatDuration(group.durationMs)}` : ''}
      </span>
    </summary>
    {open && <div className="border-t border-whx-border-soft/70 pl-2">{group.entries.map((entry) => <OutputEntry key={entry.id} entry={entry}/>)}</div>}
  </details>
}
