import { translate as uiText } from '../../../../../lib/workspace/localization'
import { useState } from 'react'
import { Icon } from '../../../../presentation/chrome/Icon'
import type { CodeProblem } from './useCodeProblems'
export function CodeProblems({ problems }: { problems: CodeProblem[] }) {
  const [query, setQuery] = useState('')
  const filtered = problems.filter((item) => `${item.path} ${item.message} ${item.source}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="flex min-h-9 items-center gap-2 border-b border-whx-border-soft px-2.5 py-1 text-[calc(10px*var(--ui-font-scale))] text-whx-faint">
      <span className="shrink-0 tabular-nums">{problems.filter((item) => item.error).length} {uiText('erros')} · {problems.filter((item) => !item.error).length} {uiText("avisos")}</span>
      <input className="h-7 min-w-0 max-w-52 flex-1 rounded-md border border-whx-border-soft bg-whx-surface px-2 text-[calc(10px*var(--ui-font-scale))] text-whx-text outline-none placeholder:text-whx-faint focus:border-whx-accent" aria-label={uiText("Filtrar problemas")} placeholder={uiText("Filtrar diagnósticos…")} value={query} onChange={(event) => setQuery(event.target.value)}/>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {filtered.length ? filtered.map((item, index) => <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('wharnex:open-code-problem', { detail: item }))} key={`${item.path}:${item.line}:${index}`} className="flex w-full border-0 bg-transparent text-left hover:bg-whx-hover focus-visible:outline-2 focus-visible:outline-whx-accent items-start gap-2 border-b border-whx-border-soft px-3 py-2 text-whx-caption">
        <span className={item.error ? 'text-whx-danger' : 'text-whx-warning'}><Icon name="alert" size={14}/></span>
        <div className="min-w-0 flex-1"><p className="m-0 break-words text-whx-text">{item.message}</p><small className="text-whx-faint">{item.path}:{item.line}:{item.column} · {item.source}</small></div>
      </button>) : <EmptyProblems filtered={Boolean(query)}/>}
    </div>
  </div>
}

function EmptyProblems({ filtered }: { filtered: boolean }) {
  return <div role="status" className="flex min-h-10 items-center gap-2 px-3 py-2 text-[calc(10.5px*var(--ui-font-scale))] text-whx-faint">
    <Icon name={filtered ? 'search' : 'check'} size={14}/>
    <span>{uiText(filtered ? 'Sem correspondências' : 'Sem diagnósticos de código')}</span>
  </div>
}
