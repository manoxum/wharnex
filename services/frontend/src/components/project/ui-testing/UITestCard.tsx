import type { UITestCase, UITestingDocument } from '../../../types'
import { dependencyOrder, effectiveAccess, effectiveProfileId, validSessionFor } from '../../../lib/ui-testing/uiTestingCatalog'

type UITestCardProps = { doc: UITestingDocument; test: UITestCase; selected: boolean; issue: string; onToggle: () => void }

const chipClass = 'rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-[var(--theme-text-muted)]'

export function UITestCard({ doc, test, selected, issue, onToggle }: UITestCardProps) {
  const prerequisites = dependencyOrder(doc, test.id)
  const profileId = effectiveProfileId(doc, test)
  const profile = doc.environments.find((env) => env.id === test.environment_id)?.profiles.find((item) => item.id === profileId)
  const session = validSessionFor(doc, test.id)
  return <article className="flex gap-3 rounded-xl border border-white/10 bg-black/10 p-3 hover:border-[var(--acid)]/50">
    <input type="checkbox" className="mt-1" aria-label={`Selecionar ${test.title}`} checked={selected} onChange={onToggle}/>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="truncate text-sm">{test.title}</strong>
        <Status value={test.status}/>
        {test.source === 'user' && <span className="rounded-full bg-[var(--acid)]/10 px-2 py-0.5 text-[10px] text-[var(--acid)]">pedido</span>}
      </div>
      <p className="mt-1 text-xs leading-5 text-[var(--theme-text-muted)]">{test.description || test.goal}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={chipClass}>{effectiveAccess(test) === 'public' ? 'Público' : `Perfil: ${profile?.label || profileId || 'por definir'}${test.profile_id ? '' : ' (herdado)'}`}</span>
        {test.category && <span className={chipClass}>{test.category}</span>}
        {test.priority && <span className={chipClass}>prioridade {test.priority}</span>}
        {prerequisites.length > 0 && <span className={chipClass}>depende de: {prerequisites.map((dep) => dep.title).join(' → ')}</span>}
        {session && <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">sessão guardada</span>}
        {issue && <span className="text-[10px] text-amber-300">configuração pendente</span>}
      </div>
      <TestDetails test={test}/>
    </div>
  </article>
}

function TestDetails({ test }: { test: UITestCase }) {
  const hasDetails = Boolean(test.preconditions?.length || test.steps?.length || test.expected_result || test.test_data?.length || test.brief)
  if (!hasDetails) return null
  return <details className="mt-2 text-xs">
    <summary className="cursor-pointer text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]">Estratégia de execução</summary>
    <div className="mt-2 space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-2 leading-5">
      {test.brief && <Section title="Pedido original"><p className="whitespace-pre-wrap">{test.brief}</p></Section>}
      {!!test.preconditions?.length && <Section title="Pré-condições"><ul className="list-disc pl-4">{test.preconditions.map((item) => <li key={item}>{item}</li>)}</ul></Section>}
      {!!test.steps?.length && <Section title="Passos"><ol className="list-decimal pl-4">{test.steps.map((step, index) => <li key={index}>{step.action}{step.expected && <span className="text-[var(--theme-text-muted)]"> → {step.expected}</span>}</li>)}</ol></Section>}
      {test.expected_result && <Section title="Resultado esperado"><p>{test.expected_result}</p></Section>}
      {!!test.test_data?.length && <Section title="Dados de teste"><ul className="list-disc pl-4">{test.test_data.map((item) => <li key={item}>{item}</li>)}</ul></Section>}
    </div>
  </details>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><span className="text-[10px] uppercase tracking-wide text-[var(--acid)]">{title}</span>{children}</section>
}

const statusTone: Record<string, string> = { passed: 'text-emerald-400', failed: 'text-red-400', running: 'text-amber-300', blocked: 'text-amber-300' }
function Status({ value }: { value: string }) {
  return <span className={`rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusTone[value] || 'text-[var(--theme-text-muted)]'}`}>{value}</span>
}
