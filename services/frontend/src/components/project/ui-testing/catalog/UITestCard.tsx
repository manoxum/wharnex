import { Icon } from '../../../presentation/chrome/Icon'
import { testDuration } from './testDuration'
import { UITestStatus } from './UITestStatus'
import type { UITestCase, UITestingDocument } from '../../../../types'
import { dependencyOrder, effectiveAccess, effectiveProfileId, validSessionFor } from '../../../../lib/ui-testing/uiTestingCatalog'

type UITestCardProps = { doc: UITestingDocument; test: UITestCase; selected: boolean; issue: string; onToggle: () => void }

export function UITestCard({ doc, test, selected, issue, onToggle }: UITestCardProps) {
  const prerequisites = dependencyOrder(doc, test.id)
  const profileId = effectiveProfileId(doc, test)
  const profile = doc.environments.find((env) => env.id === test.environment_id)?.profiles.find((item) => item.id === profileId)
  const session = validSessionFor(doc, test.id)
  const run = doc.runs.find((item) => item.id === test.last_run_id)
  const duration = testDuration(run)
  return <article aria-label={test.title} className={`flex gap-2 border-0 px-2 py-2 transition-colors motion-reduce:transition-none [[data-density=compact]_&]:py-1 ${selected ? 'bg-whx-selection' : 'bg-transparent hover:bg-whx-hover'}`}>
    <input type="checkbox" className="mt-1 h-4! w-4! shrink-0 cursor-pointer accent-[var(--theme-accent)]" aria-label={`Selecionar ${test.title}`} checked={selected} onChange={onToggle}/>
    <div className="min-w-0 flex-1">
      <details className="group/test">
        <summary aria-label={`Detalhes de ${test.title}`} className="flex min-w-0 cursor-pointer list-none items-center gap-2 text-whx-label leading-5 [&::-webkit-details-marker]:hidden">
          <span className="shrink-0 text-whx-faint transition-transform group-open/test:rotate-90 motion-reduce:transition-none"><Icon name="chevron-right" size={12}/></span>
          <strong className="min-w-0 flex-1 truncate font-medium" title={test.title}>{test.title}</strong>
          {test.source === 'user' && <span className="text-whx-caption text-whx-faint">pedido</span>}
          <UITestStatus value={test.status}/>{duration && <span className="font-mono text-whx-caption tabular-nums text-whx-faint" aria-label={`Duração ${duration}`}>{duration}</span>}
        </summary>
        <div className="ml-1.5 mt-2 space-y-3 border-l border-whx-border-soft pl-3 text-whx-label leading-5">
          <p className="!m-0 text-whx-soft">{test.description || test.goal}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-whx-caption text-whx-faint">
            <span>{effectiveAccess(test) === 'public' ? 'Público' : `Perfil: ${profile?.label || profileId || 'por definir'}${test.profile_id ? '' : ' (herdado)'}`}</span>
            {test.category && <span>{test.category}</span>}{test.priority && <span>prioridade {test.priority}</span>}
            {prerequisites.length > 0 && <span>depende de: {prerequisites.map((dep) => dep.title).join(' → ')}</span>}
            {session && <span className="text-whx-success">sessão guardada</span>}{issue && <span className="text-whx-warning">configuração pendente</span>}
          </div>
          {test.brief && <Section title="Pedido original"><p className="whitespace-pre-wrap">{test.brief}</p></Section>}
          {!!test.preconditions?.length && <Section title="Pré-condições"><ul className="list-disc pl-4">{test.preconditions.map((item) => <li key={item}>{item}</li>)}</ul></Section>}
          {!!test.steps?.length && <Section title="Passos"><ol className="list-decimal pl-4">{test.steps.map((step, index) => <li key={index}>{step.action}{step.expected && <span className="text-whx-faint"> → {step.expected}</span>}</li>)}</ol></Section>}
          {test.expected_result && <Section title="Resultado esperado"><p>{test.expected_result}</p></Section>}
          {!!test.test_data?.length && <Section title="Dados de teste"><ul className="list-disc pl-4">{test.test_data.map((item) => <li key={item}>{item}</li>)}</ul></Section>}
        </div>
      </details>
      {run?.error && <p className="!mb-0 !mt-1 break-words text-whx-label leading-5 text-whx-warning">{run.error}</p>}
    </div>
  </article>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><span className="text-whx-caption font-semibold text-whx-faint">{title}</span>{children}</section>
}
