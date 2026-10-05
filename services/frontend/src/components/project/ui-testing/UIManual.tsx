import { useMemo, useState } from 'react'
import type { UITestingDocument } from '../../../types'
import { uiTestingApi } from '../../../lib/ui-testing/uiTestingApi'
import { groupByEnvironment, guideEnvironment } from '../../../lib/ui-testing/uiTestingCatalog'
import { manualSections, resolveGuideImages } from '../../../lib/ui-testing/uiTestingManual'
import { MarkdownContent } from '../../presentation/content/MarkdownContent'

/** One user manual per environment: an index plus every guide, in reading order. */
export function UIManual({ sessionId, doc }: { sessionId: string; doc: UITestingDocument }) {
  const environments = useMemo(() => groupByEnvironment(doc, doc.guides, (guide) => guideEnvironment(doc, guide)).map((group) => group.environment), [doc])
  const [selected, setSelected] = useState('')
  const environment = environments.find((env) => env.id === selected) || environments[0]
  const sections = useMemo(() => environment ? manualSections(doc, environment.id) : [], [doc, environment])
  if (!environment) return <div className="grid min-h-52 flex-1 place-items-center p-8 text-center text-xs text-[var(--theme-text-muted)]">O manual surge quando os testes terminam e os guias são gerados.</div>
  let number = 0
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <nav aria-label="Ambientes do manual" className="flex flex-wrap gap-1.5">
      {environments.map((env) => <button key={env.id} aria-pressed={env.id === environment.id} className={`rounded-lg px-3 py-1.5 text-xs ${env.id === environment.id ? 'bg-white/10 text-[var(--theme-text)]' : 'text-[var(--theme-text-muted)] hover:bg-white/5'}`} onClick={() => setSelected(env.id)}>{env.name}</button>)}
    </nav>
    <article aria-label={`Manual de ${environment.name}`} className="min-h-0 flex-1 space-y-5 overflow-auto rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <header>
        <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--acid)]">Manual de utilização</span>
        <h3 className="mt-1 text-lg font-semibold">{environment.name}</h3>
        {environment.description && <p className="mt-1 text-xs leading-5 text-[var(--theme-text-muted)]">{environment.description}</p>}
      </header>
      <section aria-label="Índice" className="rounded-lg border border-white/10 bg-black/10 p-3 text-xs">
        <strong className="mb-2 block">Índice</strong>
        {sections.map((section) => <div key={section.category} className="mb-2">
          <span className="text-[10px] uppercase tracking-wide text-[var(--theme-text-muted)]">{section.label}</span>
          <ol className="ml-4 list-decimal">{section.entries.map((entry) => <li key={entry.anchor}><a className="hover:text-[var(--acid)]" href={`#${entry.anchor}`}>{entry.guide.title}</a></li>)}</ol>
        </div>)}
      </section>
      {sections.map((section) => <section key={section.category} aria-label={section.label} className="space-y-4">
        <h4 className="border-b border-white/10 pb-1 text-sm font-semibold text-[var(--acid)]">{section.label}</h4>
        {section.entries.map((entry) => {
          number += 1
          return <section key={entry.anchor} id={entry.anchor} className="space-y-2">
            <h5 className="text-base font-semibold">{number}. {entry.guide.title}</h5>
            {entry.test?.status && entry.test.status !== 'passed' && <p className="text-[10px] text-amber-300">Última execução: {entry.test.status}</p>}
            <MarkdownContent markdown={resolveGuideImages(entry.guide.markdown, (name) => uiTestingApi.asset(sessionId, entry.guide.run_id, name))}/>
          </section>
        })}
      </section>)}
    </article>
  </div>
}
