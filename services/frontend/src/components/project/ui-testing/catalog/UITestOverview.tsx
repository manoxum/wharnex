import type { UITestCase } from '../../../../types'

const stats = [
  { label: 'Aprovados', statuses: ['passed'], tone: 'text-whx-success' },
  { label: 'Falhas', statuses: ['failed', 'blocked'], tone: 'text-whx-danger' },
  { label: 'Em execução', statuses: ['running'], tone: 'text-whx-running' },
  { label: 'Na fila / espera', statuses: ['queued', 'waiting'], tone: 'text-whx-warning' },
]
export function UITestOverview({ tests }: { tests: UITestCase[] }) {
  return <dl aria-label="Resumo dos testes" className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-whx-label">
    {stats.map((stat) => <div key={stat.label} className="flex items-baseline gap-1.5">
      <dt className="text-whx-faint">{stat.label}</dt>
      <dd className={`m-0 order-first font-mono font-medium tabular-nums ${tests.some((test) => stat.statuses.includes(test.status)) ? stat.tone : 'text-whx-faint'}`}>{tests.filter((test) => stat.statuses.includes(test.status)).length}</dd>
    </div>)}
  </dl>
}
