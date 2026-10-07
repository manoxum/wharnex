import { WorkbenchTabs } from '../../../presentation/tabs'
import { useEffect, useMemo, useState } from 'react'
import type { UITestingDocument } from '../../../../types'
import { groupByEnvironment, guideEnvironment } from '../../../../lib/ui-testing/uiTestingCatalog'
import { Icon } from '../../../presentation/chrome/Icon'
import { UIGuideViewer } from './UIGuideViewer'
import { uiInputClass } from '../uiTestingStyles'
import { UIManual } from './UIManual'

export function UIDocsTab({ sessionId, doc }: { sessionId: string; doc: UITestingDocument }) {
  const [mode, setMode] = useState<'manual' | 'guides'>('manual')
  return <div className="@container flex min-h-0 flex-1 flex-col gap-3 p-4 text-whx-text">
    <WorkbenchTabs label="Vista da documentação" value={mode} onChange={setMode} items={[
      { id: 'manual', label: 'Manual por ambiente', icon: 'knowledge' },
      { id: 'guides', label: 'Guias individuais', icon: 'file', badge: doc.guides.length },
    ]}/>
    {mode === 'manual' ? <UIManual sessionId={sessionId} doc={doc}/> : <GuideBrowser sessionId={sessionId} doc={doc}/>}
  </div>
}

function GuideBrowser({ sessionId, doc }: { sessionId: string; doc: UITestingDocument }) {
  const [query, setQuery] = useState('')
  const [guideId, setGuideId] = useState(doc.guides[0]?.id || '')
  useEffect(() => { if (!doc.guides.some((guide) => guide.id === guideId)) setGuideId(doc.guides[0]?.id || '') }, [doc.guides, guideId])
  const guide = useMemo(() => doc.guides.find((item) => item.id === guideId), [doc.guides, guideId])
  const groups = useMemo(() => groupByEnvironment(doc, doc.guides.filter((item) => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), (item) => guideEnvironment(doc, item)), [doc, query])
  if (!guide) return <div className="grid min-h-52 flex-1 place-items-center p-8 text-center text-base text-whx-faint">Os guias surgem automaticamente quando um teste termina.</div>
  return <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 @min-[720px]:grid-cols-[220px_minmax(0,1fr)] @min-[720px]:grid-rows-[minmax(0,1fr)]">
    <nav aria-label="Guias por ambiente" className="min-h-0 max-h-52 space-y-3 overflow-auto rounded-lg border border-whx-border bg-whx-surface p-2 @min-[720px]:max-h-none">
      <input aria-label="Pesquisar guias" type="search" className={uiInputClass} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar guias…"/>
      {!groups.length && <p className="px-2 text-base text-whx-faint">Nenhum guia encontrado.</p>}
      {groups.map(({ environment, items }) => <section key={environment.id} aria-label={`Guias de ${environment.name}`}>
        <header className="flex items-center gap-1.5 px-1 py-1 text-sm uppercase tracking-wide text-whx-faint"><Icon name="server" size={11}/>{environment.name}<span className="ml-auto normal-case tracking-normal">{items.length}</span></header>
        {items.map((item) => <button key={item.id} aria-current={item.id === guideId ? 'true' : undefined} className={`flex w-full cursor-pointer items-center gap-2 rounded-md! border-0! px-2! py-2! text-left font-sans! text-base! leading-5! shadow-none! ${item.id === guideId ? 'bg-whx-accent-soft! text-whx-text!' : 'bg-transparent! text-whx-faint! hover:bg-whx-hover!'}`} onClick={() => setGuideId(item.id)}>
          <Icon name="file" size={12}/><span className="min-w-0 flex-1 truncate">{item.title}</span>
          {item.html_ready && <span className="text-sm">HTML</span>}{item.pdf_ready && <span className="text-sm">PDF</span>}
        </button>)}
      </section>)}
    </nav>
    <UIGuideViewer sessionId={sessionId} guide={guide}/>
  </div>
}
