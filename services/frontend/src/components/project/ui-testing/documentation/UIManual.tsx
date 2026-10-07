import { useMemo, useState } from 'react'
import type { UITestingDocument } from '../../../../types'
import { uiTestingApi } from '../../../../lib/ui-testing/uiTestingApi'
import { groupByEnvironment, guideEnvironment } from '../../../../lib/ui-testing/uiTestingCatalog'
import { manualSections, resolveGuideImages } from '../../../../lib/ui-testing/uiTestingManual'
import { MarkdownContent } from '../../../presentation/content/MarkdownContent'
import { WorkbenchTabs } from '../../../presentation/tabs'
import { testStatus } from '../catalog'

/** One manual per environment, with a navigable index and comfortable reading width. */
export function UIManual({ sessionId, doc }: { sessionId: string; doc: UITestingDocument }) {
  const environments = useMemo(() => groupByEnvironment(doc, doc.guides, (guide) => guideEnvironment(doc, guide)).map((group) => group.environment), [doc])
  const [selected, setSelected] = useState('')
  const environment = environments.find((env) => env.id === selected) || environments[0]
  const sections = useMemo(() => environment ? manualSections(doc, environment.id) : [], [doc, environment])
  if (!environment) return <div className="grid min-h-52 flex-1 place-items-center p-8 text-center text-base text-whx-faint">O manual surge quando os testes terminam e os guias são gerados.</div>
  let number = 0
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <WorkbenchTabs label="Ambientes do manual" value={environment.id} onChange={setSelected} items={environments.map((env) => ({ id: env.id, label: env.name, icon: 'server', badge: doc.guides.filter((guide) => guideEnvironment(doc, guide) === env.id).length }))}/>
    <article aria-label={`Manual de ${environment.name}`} className="min-h-0 flex-1 overflow-auto rounded-lg border border-whx-border bg-whx-surface p-5 text-base leading-6 text-whx-text">
      <header className="mx-auto mb-6 max-w-[76ch] border-b border-whx-border pb-4">
        <span className="text-sm font-medium uppercase tracking-widest text-whx-accent">Manual de utilização</span>
        <h3 className="mb-1! mt-2! text-xl! font-semibold! leading-7!">{environment.name}</h3>
        {environment.description && <p className="m-0! text-base! leading-6! text-whx-faint">{environment.description}</p>}
        <p className="mb-0! mt-2! text-sm! text-whx-faint">{sections.reduce((total, section) => total + section.entries.length, 0)} guias · organizados por funcionalidade</p>
      </header>
      <section aria-label="Índice" className="mx-auto mb-8 max-w-[76ch] rounded-lg border border-whx-border bg-whx-bg p-4">
        <strong className="mb-3 block text-base">Neste manual</strong>
        <div className="grid gap-4 @min-[640px]:grid-cols-2">
          {sections.map((section) => <div key={section.category}>
            <span className="text-sm font-medium text-whx-faint">{section.label}</span>
            <ol className="mb-0! mt-1! list-decimal space-y-1 pl-5!">{section.entries.map((entry) => <li key={entry.anchor}><a className="text-whx-soft! no-underline! hover:text-whx-accent! hover:underline!" href={`#${entry.anchor}`}>{entry.guide.title}</a></li>)}</ol>
          </div>)}
        </div>
      </section>
      <div className="mx-auto max-w-[76ch] space-y-8">
        {sections.map((section) => <section key={section.category} aria-label={section.label} className="space-y-6">
          <h4 className="m-0! border-b border-whx-border pb-2 text-lg! font-semibold! text-whx-accent">{section.label}</h4>
          {section.entries.map((entry) => {
            number += 1
            return <section key={entry.anchor} id={entry.anchor} className="scroll-mt-4 space-y-3">
              <h5 className="m-0! text-lg! font-semibold! leading-6!">{number}. {entry.guide.title}</h5>
              {entry.test?.status && entry.test.status !== 'passed' && <p className="text-sm text-whx-warning">Última execução: {testStatus(entry.test.status).label}</p>}
              <MarkdownContent markdown={resolveGuideImages(entry.guide.markdown, (name) => uiTestingApi.asset(sessionId, entry.guide.run_id, name))}/>
            </section>
          })}
        </section>)}
      </div>
    </article>
  </div>
}
