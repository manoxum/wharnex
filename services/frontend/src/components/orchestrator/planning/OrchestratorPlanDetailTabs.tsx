import { translate as uiText } from '../../../lib/workspace/localization'
import { useState } from 'react'
import type { ArtifactRecord, OrchestratorPlanningDetail } from '../../../types'
import { BundleExplorerModal } from '../../artifacts/explorer/BundleExplorer'
import { Icon } from '../../presentation/chrome/Icon'

// The ZIPs exchanged with ChatGPT to produce the plan, explorable exactly as
// an agentic chat's bundles.
function PlanningBundles({ sessionId, bundles }: { sessionId?: string; bundles: ArtifactRecord[] }) {
  const [open, setOpen] = useState<ArtifactRecord>()
  return <section className="grid gap-2">
    <SectionTitle title={uiText("Bundles trocados com o GPT")} count={bundles.length}/>
    {bundles.length ? <ul className="m-0 grid list-none gap-1.5 p-0">
      {bundles.map((bundle) => <li key={bundle.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--theme-border-soft)] p-2.5">
        <span className="min-w-0">
          <code className="block break-all text-sm text-[var(--theme-text)]">{bundle.name}</code>
          <span className="mt-1 flex flex-wrap gap-1">
            <span className="rounded-full bg-[var(--theme-subtle)] px-1.5 py-0.5 text-xs text-[var(--theme-text-muted)]">{bundle.direction === 'input' ? uiText("Pedido enviado") : uiText("Resposta do GPT")}</span>
            <span className="rounded-full bg-[var(--theme-subtle)] px-1.5 py-0.5 text-xs text-[var(--theme-text-muted)]">{formatBytes(bundle.size)}</span>
          </span>
        </span>
        {sessionId ? <button type="button" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-elevated)] px-2.5 py-1.5 text-sm font-semibold" onClick={() => setOpen(bundle)}><Icon name="package" size={13}/> {' '}{uiText("Explorar")}</button> : null}
      </li>)}
    </ul> : <p className="m-0 text-sm text-[var(--theme-text-muted)]">{uiText("Nenhum bundle registado para este planeamento. Os planeamentos anteriores a esta versão não guardavam os bundles.")}</p>}
    {open && sessionId ? <BundleExplorerModal sessionId={sessionId} bundle={open} onClose={() => setOpen(undefined)}/> : null}
  </section>
}

export function OrchestratorPlanFilesTab({ detail, sessionId }: { detail: OrchestratorPlanningDetail; sessionId?: string }) {
  const bundles = detail.bundles || []
  if (!bundles.length) return <EmptyState message={uiText("Nenhum bundle de pedido ou resposta foi registado para este planeamento.")}/>
  return <PlanningBundles sessionId={sessionId} bundles={bundles}/>
}

export function OrchestratorPlanTab({ detail }: { detail: OrchestratorPlanningDetail }) {
  const [search, setSearch] = useState('')
  if (!detail.plan) return <EmptyState message="Planeamento ainda não concluído/importado. Este pedido ainda não possui um plano disponível."/>

  const plan = detail.plan
  const names = new Map(detail.tasks.map(({ task }) => [task.id, task.title]))
  const query = normalizeSearch(search)
  const visibleTasks = detail.tasks.filter(({ task }) => matches(
    query, task.id, task.title, task.status, ...(task.depends_on || []),
    ...(task.depends_on || []).map((id) => names.get(id)),
  ))

  return <div className="grid gap-4">
    <section className="grid gap-2 rounded-lg border border-[var(--theme-border)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><span className="font-mono text-sm text-[var(--theme-text-soft)]">{plan.id}</span><h3 className="m-0 mt-0.5 text-lg">{plan.title}</h3></div>
        <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-subtle)] px-2 py-1 font-mono text-sm font-bold">{plan.status}</span>
      </div>
      <div><strong className="text-sm">{uiText("Objetivo")}</strong><p className="mb-0 mt-1 whitespace-pre-wrap text-sm text-[var(--theme-text-muted)]">{plan.objective || detail.objective || 'Sem objetivo registrado.'}</p></div>
      <div><strong className="text-sm">Assumptions</strong>{plan.assumptions?.length
        ? <ul className="mb-0 mt-1 pl-5 text-sm text-[var(--theme-text-muted)]">{plan.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
        : <p className="mb-0 mt-1 text-sm text-[var(--theme-text-muted)]">{uiText("Nenhuma assumption registrada.")}</p>}
      </div>
    </section>
    <section className="grid gap-2">
      <SectionTitle title={uiText("Estrutura DAG das tasks")} count={detail.tasks.length}/>
      {detail.tasks.length ? <SearchBox value={search} onChange={setSearch} label={uiText("Pesquisar tasks e dependências")}/> : null}
      <div className="grid gap-2">{visibleTasks.map(({ task }) => <article key={task.id} className="rounded-lg border border-[var(--theme-border-soft)] bg-[var(--theme-subtle)] p-2.5">
        <div className="flex items-start justify-between gap-2"><strong className="text-sm">{task.title}</strong><span className="font-mono text-xs text-[var(--theme-text-soft)]">{task.status}</span></div>
        <code className="mt-1 block break-all text-xs text-[var(--theme-text-soft)]">{task.id}</code>
        <p className="mb-0 mt-1 text-sm text-[var(--theme-text-muted)]">{task.depends_on?.length ? `← ${task.depends_on.map((id) => names.get(id) || id).join(' · ')}` : uiText("Ponto de entrada · sem dependências")}</p>
      </article>)}</div>
      {!detail.tasks.length ? <EmptyState message="O plano ainda não possui tasks importadas."/> : !visibleTasks.length ? <InlineEmpty search={search}/> : null}
    </section>
  </div>
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return <label className="flex min-h-9 items-center gap-2 rounded-md border border-[var(--theme-border)] bg-[var(--theme-subtle)] px-2 text-[var(--theme-text-muted)]"><Icon name="search" size={13}/><input className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--theme-text)] outline-none" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} placeholder={label}/></label>
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return <header className="flex items-center justify-between gap-2"><strong className="text-base">{title}</strong><span className="rounded-full bg-[var(--theme-subtle)] px-2 py-0.5 font-mono text-xs text-[var(--theme-text-soft)]">{count}</span></header>
}

function EmptyState({ message }: { message: string }) {
  return <div className="mt-3 rounded-lg border border-dashed border-[var(--theme-border)] p-4 text-sm text-[var(--theme-text-muted)]">{message}</div>
}

function InlineEmpty({ search, fallback = 'Nenhum item corresponde à pesquisa.' }: { search: string; fallback?: string }) {
  return <p className="m-0 text-sm text-[var(--theme-text-muted)]">{search.trim() ? uiText("Nenhum item corresponde à pesquisa.") : fallback}</p>
}

function normalizeSearch(value: string) { return value.trim().toLocaleLowerCase('pt') }
function matches(query: string, ...values: Array<string | undefined>) { return !query || values.some((value) => value?.toLocaleLowerCase('pt').includes(query)) }
function formatBytes(value?: number) {
  if (value === undefined) return 'tamanho não informado'
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const rank = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  const amount = value / (1024 ** rank)
  return `${rank === 0 || amount >= 10 ? Math.round(amount) : amount.toFixed(1)} ${units[rank]}`
}
