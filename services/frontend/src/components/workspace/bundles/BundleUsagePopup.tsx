import { useEffect, useId, useRef } from 'react'
import type { BundleQuota } from '../../../types'
import { taskCategories } from '../../agent/runtime/task-policies/taskPolicyCatalog'
import { InternalWindow } from '../window/InternalWindow'

const labels = new Map(taskCategories.flatMap((category) => category.types.map(([type, label]) => [type, label])))
labels.set('AGENT_REQUEST', 'Pedido Agent')
labels.set('UNATTRIBUTED', 'Tipo não identificado')
const actionStyle = 'cursor-pointer rounded border border-(--theme-border) bg-transparent px-3 py-1.5 text-(--theme-text) hover:bg-(--theme-hover) focus-visible:outline-2 focus-visible:outline-(--theme-accent)'
const numberStyle = 'px-3 py-2 text-right font-[family-name:var(--mono-font-family)] tabular-nums'

export function BundleUsagePopup({ quota, error, onClose, onRefresh }: {
  quota: BundleQuota; error: string; onClose: () => void; onRefresh: () => void
}) {
  const close = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  useEffect(() => {
    const previous = document.activeElement
    close.current?.focus()
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  const rows = [...(quota.by_task_type || [])].sort((a, b) => b.total - a.total || a.type.localeCompare(b.type))
  const emptyDetail = quota.total === 0 ? 'Sem detalhe por tarefa nesta janela.'
    : quota.by_task_type == null ? 'O serviço de estatísticas ainda não fornece o consumo por tipo de tarefa. Atualize o Wharnex para obter a discriminação. Os totais disponíveis estão apresentados acima.'
      : 'A discriminação por tipo de tarefa está indisponível. Tente atualizar as estatísticas.'
  const clock = (value: string) => new Date(value).toLocaleString('pt-PT', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
  const title = `Bundles nas últimas ${quota.window_hours} horas`
  return <InternalWindow title={title} onClose={onClose}><section role="dialog" aria-modal="false" aria-labelledby={titleId}
    className="flex max-h-[calc(100dvh-48px)] w-[640px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-lg border border-(--theme-border) bg-(--theme-surface) text-[12px] text-(--theme-text) shadow-xl">
      <header className="flex items-start justify-between gap-4 border-b border-(--theme-border) p-4 pr-[100px]">
        <div><h2 id={titleId} className="m-0 text-[15px] font-semibold">Bundles nas últimas {quota.window_hours} horas</h2><p className="mt-1 mb-0 text-(--theme-text-muted)">{clock(quota.window_start)} — {clock(quota.window_end)} · Todos os projetos e pools</p></div>
      </header>
      <div className="overflow-auto p-4">
        {error && <p role="alert" className="mt-0 text-(--theme-danger)">{error} Os valores apresentados são da última consulta bem-sucedida.</p>}
        <table className="w-full border-collapse text-left">
          <caption className="mb-3 text-left text-(--theme-text-muted)">Consumo por tipo de tarefa · {quota.total} bundles trocados</caption>
          <thead className="border-b border-(--theme-border) text-(--theme-text-muted)"><tr><th scope="col" className="py-2 font-medium">Tipo de tarefa</th>{['Enviados', 'Recebidos', 'Total'].map((name) => <th key={name} scope="col" className={`${numberStyle} font-medium`}>{name}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.type} className="border-b border-(--theme-border-soft)">
            <th scope="row" className="py-2 font-medium"><span className="block">{labels.get(row.type) || row.type}</span><small className="text-[10px] font-normal text-(--theme-text-muted)">{row.type}</small></th>
            <td className={numberStyle}>{row.sent}</td><td className={numberStyle}>{row.received}{row.estimated_received > 0 && <span title={`${row.estimated_received} recebidos estimados a partir de entregas anteriores`}>*</span>}</td><td className={`${numberStyle} font-semibold`}>{row.total}</td>
          </tr>)}</tbody>
          <tfoot><tr className="font-semibold"><th scope="row" className="pt-3">Total</th><td className={numberStyle}>{quota.sent}</td><td className={numberStyle}>{quota.received}</td><td className={numberStyle}>{quota.total}</td></tr></tfoot>
        </table>
        {rows.length === 0 && <p role="status" className="text-(--theme-text-muted)">{emptyDetail}</p>}
        <p className="mb-0 text-(--theme-text-muted)">Estimativa local Wharnex; não é a quota oficial da conta. Só os enviados consomem o limite local de {quota.limit} uploads.</p>
        {quota.source === 'artifacts' && <p className="mb-0 text-(--theme-text-muted)">Modo de desenvolvimento: contagem por artefactos preparados, sem confirmação de transporte.</p>}
        {(quota.estimated_received || 0) > 0 && <p className="mb-0 text-(--theme-text-muted)">* {quota.estimated_received} recebidos estimados por entregas anteriores ao registo de downloads.</p>}
        {quota.warning && <p className="mb-0 text-(--theme-danger)">Limite local atingido. Novos pedidos continuam permitidos.</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-(--theme-border) p-3"><button type="button" className={actionStyle} onClick={onRefresh}>Atualizar</button><button ref={close} type="button" className={actionStyle} onClick={onClose}>Fechar</button></footer>
    </section></InternalWindow>
}
