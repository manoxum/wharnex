import { useEffect, useMemo, useState } from 'react'
import type { UIGuide, UITestingDocument } from '../../../types'
import { uiTestingApi } from '../../../lib/ui-testing/uiTestingApi'
import { groupByEnvironment, guideEnvironment } from '../../../lib/ui-testing/uiTestingCatalog'
import { Icon } from '../../presentation/chrome/Icon'
import { uiPrimaryButtonClass, uiSecondaryButtonClass } from './uiTestingStyles'
import { UIManual } from './UIManual'

export function UIDocsTab({ sessionId, doc }: { sessionId: string; doc: UITestingDocument }) {
  const [mode, setMode] = useState<'manual' | 'guides'>('manual')
  return <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
    <div role="tablist" aria-label="Vista da documentação" className="flex gap-1.5">
      {([['manual', 'Manual por ambiente'], ['guides', 'Guias individuais']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={mode === id} className={mode === id ? uiPrimaryButtonClass : uiSecondaryButtonClass} onClick={() => setMode(id)}>{label}</button>)}
    </div>
    {mode === 'manual' ? <UIManual sessionId={sessionId} doc={doc}/> : <GuideBrowser sessionId={sessionId} doc={doc}/>}
  </div>
}

function GuideBrowser({ sessionId, doc }: { sessionId: string; doc: UITestingDocument }) {
  const [guideId, setGuideId] = useState(doc.guides[0]?.id || ''); const [format, setFormat] = useState<'live'|'md'|'pdf'>('live'); const [step, setStep] = useState(0)
  useEffect(() => { if (!doc.guides.some((guide) => guide.id === guideId)) setGuideId(doc.guides[0]?.id || '') }, [doc.guides, guideId])
  const guide = useMemo(() => doc.guides.find((item) => item.id === guideId), [doc.guides, guideId])
  const groups = useMemo(() => groupByEnvironment(doc, doc.guides, (item) => guideEnvironment(doc, item)), [doc])
  if (!guide) return <div className="grid min-h-52 flex-1 place-items-center p-8 text-center text-xs text-[var(--theme-text-muted)]">Os guias surgem automaticamente quando um teste termina.</div>
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <nav aria-label="Guias por ambiente" className="max-h-56 space-y-2 overflow-auto rounded-xl border border-white/10 bg-white/[0.02] p-2">
      {groups.map(({ environment, items }) => <section key={environment.id} aria-label={`Guias de ${environment.name}`}>
        <header className="flex items-center gap-1.5 px-1 py-1 text-[10px] uppercase tracking-wide text-[var(--theme-text-muted)]"><Icon name="server" size={11}/>{environment.name}<span className="ml-auto normal-case tracking-normal">{items.length}</span></header>
        {items.map((item) => <button key={item.id} aria-current={item.id === guideId ? 'true' : undefined} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${item.id === guideId ? 'bg-white/10 text-[var(--theme-text)]' : 'text-[var(--theme-text-muted)] hover:bg-white/5'}`} onClick={() => { setGuideId(item.id); setStep(0) }}>
          <Icon name="file" size={12}/><span className="min-w-0 flex-1 truncate">{item.title}</span>{item.pdf_ready && <span className="text-[10px]">PDF</span>}
        </button>)}
      </section>)}
    </nav>
    <div className="flex flex-wrap gap-2">{(['live','md','pdf'] as const).map((item) => <button key={item} className={format === item ? uiPrimaryButtonClass : uiSecondaryButtonClass} disabled={item === 'pdf' && !guide.pdf_ready} onClick={() => setFormat(item)}>{item === 'live' ? 'Live' : item.toUpperCase()}</button>)}</div>
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/10 bg-white/[0.03] p-3">{format === 'md' ? <pre className="whitespace-pre-wrap text-xs leading-6">{guide.markdown}</pre> : format === 'pdf' ? <iframe title={`PDF ${guide.title}`} className="h-full min-h-[520px] w-full rounded-lg bg-white" src={uiTestingApi.asset(sessionId, guide.run_id, 'guide.pdf')}/> : <LiveGuide sessionId={sessionId} guide={guide} step={step} onStep={setStep}/>}</div>
  </div>
}
function LiveGuide({ sessionId, guide, step, onStep }: { sessionId: string; guide: UIGuide; step: number; onStep: (step: number) => void }) {
  const items = guide.screenshots || []; const current = items[Math.min(step, Math.max(0, items.length - 1))]
  return <article className="space-y-4"><header><span className="text-[10px] uppercase tracking-[0.2em] text-[var(--acid)]">Guia interativo</span><h3 className="mt-1 text-base font-semibold">{guide.title}</h3></header>{current?.screenshot && <figure className="overflow-hidden rounded-xl border border-white/10 bg-black/20"><img className="w-full" src={uiTestingApi.asset(sessionId, guide.run_id, current.screenshot)} alt={current.screen_caption || current.caption || `Passo ${current.index}`}/><figcaption className="p-3 text-xs text-[var(--theme-text-muted)]">{current.index}. {current.screen_caption || current.caption || current.outcome}{current.screen_caption && current.caption ? <span className="mt-1 block text-[10px]">Ação: {current.caption}</span> : null}</figcaption></figure>}<div className="flex items-center justify-between"><button className={uiSecondaryButtonClass} disabled={step <= 0} onClick={() => onStep(step-1)}>Anterior</button><span className="text-xs text-[var(--theme-text-muted)]">{items.length ? `${step+1} / ${items.length}` : 'Sem capturas'}</span><button className={uiSecondaryButtonClass} disabled={step >= items.length-1} onClick={() => onStep(step+1)}>Seguinte</button></div><details><summary className="cursor-pointer text-xs">Texto completo do guia</summary><pre className="mt-2 whitespace-pre-wrap text-xs leading-6 text-[var(--theme-text-muted)]">{guide.markdown}</pre></details></article>
}
