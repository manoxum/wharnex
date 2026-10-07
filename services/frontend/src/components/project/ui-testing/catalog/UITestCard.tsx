import { UITestStatus } from './UITestStatus'
import type { UITestCase, UITestingDocument } from '../../../../types'
import { dependencyOrder, effectiveAccess, effectiveProfileId, validSessionFor } from '../../../../lib/ui-testing/uiTestingCatalog'

type UITestCardProps = { doc: UITestingDocument; test: UITestCase; selected: boolean; issue: string; onToggle: () => void }

const chipClass = 'rounded bg-whx-muted px-2 py-0.5 text-sm text-whx-faint'

export function UITestCard({ doc, test, selected, issue, onToggle }: UITestCardProps) {
  const prerequisites = dependencyOrder(doc, test.id)
  const profileId = effectiveProfileId(doc, test)
  const profile = doc.environments.find((env) => env.id === test.environment_id)?.profiles.find((item) => item.id === profileId)
  const session = validSessionFor(doc, test.id)
  const error = doc.runs.find((run) => run.id === test.last_run_id)?.error
  return <article className={`flex gap-3 rounded-lg border p-3 transition-colors ${selected ? 'border-whx-accent/50 bg-whx-accent-soft/30' : 'border-whx-border bg-whx-surface hover:border-whx-border-soft'}`}>
    <input type="checkbox" className="mt-1 h-4! w-4! shrink-0 cursor-pointer accent-[var(--theme-accent)]" aria-label={`Selecionar ${test.title}`} checked={selected} onChange={onToggle}/>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="min-w-0 flex-1 text-base leading-5">{test.title}</strong>
        <UITestStatus value={test.status}/>
        {test.source === 'user' && <span className="rounded-full bg-whx-accent-soft px-2 py-0.5 text-sm text-whx-accent">pedido</span>}
      </div>
      <p className="mt-1 text-base leading-5 text-whx-soft">{test.description || test.goal}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={chipClass}>{effectiveAccess(test) === 'public' ? 'Público' : `Perfil: ${profile?.label || profileId || 'por definir'}${test.profile_id ? '' : ' (herdado)'}`}</span>
        {test.category && <span className={chipClass}>{test.category}</span>}
        {test.priority && <span className={chipClass}>prioridade {test.priority}</span>}
        {prerequisites.length > 0 && <span className={chipClass}>depende de: {prerequisites.map((dep) => dep.title).join(' → ')}</span>}
        {session && <span className="rounded-full bg-whx-success/10 px-2 py-0.5 text-sm text-whx-success">sessão guardada</span>}
        {issue && <span className="text-sm text-whx-warning">configuração pendente</span>}
      </div>
      {error && <p className="mt-2 break-words text-sm leading-5 text-whx-warning">{error}</p>}
      <TestDetails test={test}/>
    </div>
  </article>
}

function TestDetails({ test }: { test: UITestCase }) {
  const hasDetails = Boolean(test.preconditions?.length || test.steps?.length || test.expected_result || test.test_data?.length || test.brief)
  if (!hasDetails) return null
  return <details className="mt-2 text-base">
    <summary className="cursor-pointer text-whx-faint hover:text-whx-text">Estratégia de execução</summary>
    <div className="mt-2 space-y-2 rounded-lg border border-whx-border bg-whx-bg p-2 leading-5">
      {test.brief && <Section title="Pedido original"><p className="whitespace-pre-wrap">{test.brief}</p></Section>}
      {!!test.preconditions?.length && <Section title="Pré-condições"><ul className="list-disc pl-4">{test.preconditions.map((item) => <li key={item}>{item}</li>)}</ul></Section>}
      {!!test.steps?.length && <Section title="Passos"><ol className="list-decimal pl-4">{test.steps.map((step, index) => <li key={index}>{step.action}{step.expected && <span className="text-whx-faint"> → {step.expected}</span>}</li>)}</ol></Section>}
      {test.expected_result && <Section title="Resultado esperado"><p>{test.expected_result}</p></Section>}
      {!!test.test_data?.length && <Section title="Dados de teste"><ul className="list-disc pl-4">{test.test_data.map((item) => <li key={item}>{item}</li>)}</ul></Section>}
    </div>
  </details>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><span className="text-sm uppercase tracking-wide text-whx-accent">{title}</span>{children}</section>
}
