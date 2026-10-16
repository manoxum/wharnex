import { useEffect, useState } from 'react'
import type { GitOperation } from './operationTypes'
import { Button } from '../../../presentation/workbench'
import { WindowPanelHeader } from '../../../workspace/window/chrome'

export function GitOperationSelecting({ operation, onClose }: { operation: GitOperation; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(() => initialSelection(operation))
  const availableTargets = (operation.targets || []).filter((target) => target.available !== false)
  useEffect(() => { setSelected(initialSelection(operation)) }, [operation])
  return <>
    <WindowPanelHeader title={operation.title} description={operation.detail} icon="git" onClose={onClose}/>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-whx-border-soft px-4 py-3 text-whx-label text-whx-faint"><span>{selected.size} de {availableTargets.length} selecionado(s)</span><div className="flex gap-2"><Button tone="quiet" onClick={() => setSelected(new Set(availableTargets.map((target) => target.path)))} disabled={selected.size === availableTargets.length}>Todos</Button><Button tone="quiet" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Nenhum</Button></div></div>
    <ul className="!m-0 grid min-h-0 list-none content-start gap-1 overflow-y-auto !p-3" aria-label="Repositórios para a operação">{(operation.targets || []).map((target) => {
      const enabled = target.available !== false
      const detail = target.detail ? `${target.branch} · ${target.detail}` : target.branch
      return <li key={target.path || '__root__'}><label className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-lg p-3 hover:bg-whx-hover ${enabled ? '' : 'opacity-40'}`}><input className="mt-1 size-4 shrink-0 accent-whx-accent" type="checkbox" aria-label={`Executar em ${target.label}`} disabled={!enabled} checked={selected.has(target.path)} onChange={() => setSelected((current) => toggleTarget(current, target.path))}/><span className="min-w-0 flex-1"><strong className="block break-words text-whx-label font-medium text-whx-text" title={target.label}>{target.label}</strong><small className="mt-1 block break-all font-mono text-whx-caption leading-relaxed text-whx-faint" title={detail}>{detail}</small></span><span className="flex shrink-0 gap-2 font-mono text-whx-caption text-whx-faint" aria-label={`${target.ahead || 0} para enviar e ${target.behind || 0} para receber`}><b title={`${target.ahead || 0} commit(s) para enviar`}>↑{target.ahead || 0}</b><b title={`${target.behind || 0} commit(s) para receber`}>↓{target.behind || 0}</b></span></label></li>
    })}</ul>
    <footer className="flex shrink-0 justify-end gap-2 border-t border-whx-border-soft bg-whx-surface px-4 py-3"><Button onClick={onClose}>Cancelar</Button><Button tone="primary" disabled={selected.size === 0} onClick={() => operation.onConfirmTargets?.(Array.from(selected))}>Continuar ({selected.size})</Button></footer>
  </>
}
function initialSelection(operation: GitOperation) {
  const allowed = (operation.targets || []).filter((target) => target.available !== false).map((target) => target.path)
  return new Set(operation.defaultTargets?.length ? operation.defaultTargets.filter((path) => allowed.includes(path)) : allowed)
}
function toggleTarget(current: Set<string>, path: string) { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next }
