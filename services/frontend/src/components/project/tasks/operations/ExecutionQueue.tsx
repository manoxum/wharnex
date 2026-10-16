import { useEffect, useState } from 'react'
import type { ExecutionFIFOItem } from '../../../../lib/execution/history/executionQueueView'
import { api } from '../../../../lib/transport/http/api'
import { Icon } from '../../../presentation/chrome/Icon'
import { Field, Select, StatusBadge } from '../../../presentation/workbench'

export function ExecutionQueue({ items, onError }: { items: ExecutionFIFOItem[]; onError?: (message: string) => void }) {
  const [concurrency, setConcurrency] = useState<number>()
  const [max, setMax] = useState(1)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    api.executionConcurrency().then((value) => { if (alive) { setConcurrency(value.concurrency); setMax(value.max) } }).catch(() => undefined)
    return () => { alive = false }
  }, [])
  async function apply(next: number) {
    if (busy) return
    setBusy(true)
    try { const value = await api.updateExecutionConcurrency(next); setConcurrency(value.concurrency); setMax(value.max) }
    catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível alterar a concorrência') }
    finally { setBusy(false) }
  }
  return <section className="border-b border-whx-border-soft pb-3 text-whx-label" aria-label="Execução FIFO integrada">
    <details className="group">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-whx-faint hover:bg-whx-hover focus-visible:outline-whx-accent [&::-webkit-details-marker]:hidden"><Icon name="chevron-right" size={13}/><span className="flex-1">Motor de execução · FIFO</span><span className="font-mono text-whx-caption">{items.filter((item) => item.status === 'running' || item.status === 'submitting').length} ativas</span></summary>
      <div className="grid gap-3 px-2 pb-3 pt-2">
        {!items.length && <p className="!m-0 !text-whx-caption !text-whx-faint">Sem execuções ativas ou recentes. A próxima entrada FIFO aparecerá aqui.</p>}
        <p className="!m-0 !text-whx-caption !leading-relaxed !text-whx-faint">As operações respeitam a ordem da fila. Cada execução Protected reserva o seu próprio clone.</p>
        {concurrency !== undefined && <Field label="Execuções simultâneas" description={`Limite por projeto · máximo ${max}`}><Select aria-label="Execuções simultâneas por projeto" value={concurrency} disabled={busy} onChange={(event) => void apply(Number(event.target.value))}>{Array.from({ length: max }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}</Select></Field>}
      </div>
    </details>
    {items.length > 0 && <div className="mt-1 grid gap-1">{items.map((item) => <QueueEntry key={item.key} item={item}/>)}</div>}
  </section>
}
function QueueEntry({ item }: { item: ExecutionFIFOItem }) {
  const date = new Date(item.completedAt || item.addedAt)
  const state = item.status === 'running' ? 'Em execução' : item.status === 'submitting' ? 'A iniciar' : item.status === 'queued' ? 'Na fila' : item.status === 'completed' ? 'Concluída' : 'Com erro'
  return <article className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-whx-surface p-3">
    <Icon name={item.status === 'completed' ? 'check' : item.status === 'failed' ? 'alert' : 'terminal'} size={15}/>
    <span className="min-w-0 flex-1"><strong className="block truncate text-whx-label font-medium text-whx-text">{item.chatTitle}</strong><small className="mt-1 block truncate font-mono text-whx-caption text-whx-faint" title={item.planId}>{item.planId}</small>{Number.isFinite(date.getTime()) && <time className="mt-1 block text-whx-caption text-whx-faint" dateTime={date.toISOString()} title={date.toLocaleString('pt-PT')}>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}</span>
    <StatusBadge tone={item.status === 'failed' ? 'danger' : item.status === 'completed' ? 'success' : item.status === 'queued' ? 'neutral' : 'info'}>{state}</StatusBadge>{item.status === 'queued' && <span className="font-mono text-whx-caption text-whx-faint">#{String(item.position || 1).padStart(2, '0')}</span>}
  </article>
}
