import type { UITestCase } from '../../../../types'

const stats = [
  { label: 'Aprovados', statuses: ['passed'], tone: 'text-whx-success' },
  { label: 'Falhas', statuses: ['failed', 'blocked'], tone: 'text-whx-danger' },
  { label: 'Em execução', statuses: ['running'], tone: 'text-whx-accent' },
  { label: 'Na fila / espera', statuses: ['queued', 'waiting'], tone: 'text-whx-warning' },
]
export function UITestOverview({ tests }: { tests: UITestCase[] }) {
  return <dl aria-label="Resumo dos testes" className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-whx-border bg-whx-border @min-[480px]:grid-cols-4">
    {stats.map((stat) => <div key={stat.label} className="bg-whx-surface px-3 py-2.5">
      <dt className="text-sm leading-5 text-whx-faint">{stat.label}</dt>
      <dd className={`m-0 font-mono text-xl font-semibold tabular-nums ${stat.tone}`}>{tests.filter((test) => stat.statuses.includes(test.status)).length}</dd>
    </div>)}
  </dl>
}
