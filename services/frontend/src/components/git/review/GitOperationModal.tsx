import { useEffect, useState } from 'react'
import type { GitOperationPreview } from '../../../types'
import { GitDiffReview } from './GitDiffReview'
import { Icon } from '../../presentation/chrome/Icon'
import { InternalWindow } from '../../workspace/window/InternalWindow'

export type GitOperationPhase = 'selecting' | 'preparing' | 'reviewing' | 'running' | 'refreshing' | 'success' | 'error'
export type GitOperationTarget = {
  path: string
  label: string
  branch: string
  detail?: string
  ahead?: number
  behind?: number
  available?: boolean
}
export type GitOperation = {
  title: string
  detail: string
  phase: GitOperationPhase
  message?: string
  failedPhase?: 'preparing' | 'running' | 'refreshing'
  targets?: GitOperationTarget[]
  defaultTargets?: string[]
  onConfirmTargets?: (paths: string[]) => void
  previews?: GitOperationPreview[]
  onConfirmReview?: () => void
  reviewMessage?: string
  quickCommit?: {
    fileCount: number
    repositoryCount: number
    unavailableReason?: string
    onCommit: (message: string) => void
  }
}

export function GitOperationModal({ operation, sessionId = '', onClose }: { operation: GitOperation; sessionId?: string; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(() => initialSelection(operation))
  const [activePreview, setActivePreview] = useState(0)
  const [quickCommitMessage, setQuickCommitMessage] = useState('')
  const availableTargets = (operation.targets || []).filter((target) => target.available !== false)
  useEffect(() => { setSelected(initialSelection(operation)); setActivePreview(0); setQuickCommitMessage('') }, [operation])

  const selecting = operation.phase === 'selecting'
  const reviewing = operation.phase === 'reviewing'
  const running = operation.phase === 'preparing' || operation.phase === 'running' || operation.phase === 'refreshing'
  const success = operation.phase === 'success'
  const phaseLabel = operation.phase === 'preparing'
    ? 'A analisar exatamente as alterações antes da confirmação…'
    : operation.phase === 'running'
      ? 'A executar operação Git…'
      : operation.phase === 'refreshing'
        ? 'A atualizar o estado do projeto…'
        : success ? 'Operação concluída'
          : operation.failedPhase === 'refreshing' ? 'A ação terminou, mas o painel não foi atualizado' : 'A operação Git falhou'

  if (reviewing) {
    const previews = operation.previews || []
    const preview = previews[Math.min(activePreview, Math.max(0, previews.length - 1))]
    return <InternalWindow title={operation.title} layerClassName="git-operation-backdrop" onClose={onClose} maximizable>
      <section className="isolate flex h-[min(86vh,900px)] w-[min(96vw,1680px)] min-w-0 flex-col overflow-hidden rounded-xl border border-whx-border bg-whx-surface" role="dialog" aria-modal="false" aria-label={operation.title}>
        <header className="flex items-center justify-between gap-3 border-b border-whx-border px-4 py-3">
          <div className="min-w-0"><span className="panel-kicker">Revisão antes de executar</span><strong className="block truncate">{operation.title}</strong><p className="m-0 truncate text-xs text-whx-muted">{operation.detail}</p></div>
          <button type="button" className="icon-button light" onClick={onClose} aria-label="Fechar revisão"><Icon name="close" size={14}/></button>
        </header>
        {operation.reviewMessage && <p className="m-0 border-b border-whx-border bg-whx-elevated px-4 py-2 text-xs text-whx-muted" role="status">{operation.reviewMessage}</p>}
        {operation.quickCommit && <section className="border-b border-whx-border bg-whx-surface px-4 py-3" aria-label="Commit rápido antes do push">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[260px] flex-1 text-xs text-whx-muted"><span className="mb-1 block font-semibold text-whx-text">Commit rápido antes do push</span><input type="text" className="w-full rounded-md border border-whx-border bg-whx-elevated px-3 py-2 text-sm text-whx-text outline-none" aria-label="Mensagem do commit rápido" placeholder="Ex.: fix(git): ajustar publicação" value={quickCommitMessage} onChange={(event) => setQuickCommitMessage(event.target.value)}/></label>
            <button type="button" className="git-action primary" disabled={!quickCommitMessage.trim() || Boolean(operation.quickCommit.unavailableReason)} onClick={() => operation.quickCommit?.onCommit(quickCommitMessage.trim())}>Commit rápido</button>
          </div>
          <p className="mb-0 mt-2 text-xs text-whx-muted">Cria um commit com todas as {operation.quickCommit.fileCount} alteração(ões) comitáveis em {operation.quickCommit.repositoryCount} repositório(s) selecionado(s). O diff do push será recalculado antes da confirmação final.</p>
          {operation.quickCommit.unavailableReason && <p className="mb-0 mt-2 text-xs text-whx-warning" role="alert">{operation.quickCommit.unavailableReason}</p>}
        </section>}
        {previews.length > 1 && <nav className="flex gap-1 overflow-x-auto border-b border-whx-border px-3 py-2" aria-label="Repositórios revistos">{previews.map((item, index) => <button key={`${item.repository}-${index}`} type="button" className={`rounded-md px-3 py-1.5 text-xs ${index === activePreview ? 'bg-whx-elevated text-whx-text' : 'text-whx-muted hover:bg-whx-hover'}`} onClick={() => setActivePreview(index)}>{`${item.repository || 'Projeto principal'} · ${item.to_label}`}</button>)}</nav>}
        {preview ? <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-whx-border px-4 py-2 text-xs text-whx-muted"><span className="rounded-md bg-whx-surface px-2 py-1"><b className="text-whx-text">Antes:</b> {preview.from_label}</span><Icon name="arrow-right" size={12}/><span className="rounded-md bg-whx-surface px-2 py-1"><b className="text-whx-text">Depois:</b> {preview.to_label}</span>{preview.truncated && <span className="ml-auto text-whx-warning">Diff limitado a 2 MiB</span>}</div>
          <div className="relative z-0 min-h-0 flex-1 overflow-hidden"><GitDiffReview sessionId={sessionId} diff={preview.diff} emptyText="Não há diferenças de conteúdo para esta operação." fragmentOnly/></div>
        </div> : <div className="flex flex-1 items-center justify-center text-sm text-whx-muted">Sem alterações para rever.</div>}
        <footer className="relative z-10 flex shrink-0 items-center justify-end gap-2 border-t border-whx-border bg-whx-surface px-4 py-3" data-internal-window-no-drag><button type="button" className="git-action" onClick={onClose}>Cancelar</button><button type="button" className="git-action primary pointer-events-auto" onClick={() => operation.onConfirmReview?.()}>Confirmar e continuar</button></footer>
      </section>
    </InternalWindow>
  }

  if (selecting) {
    return <InternalWindow title={operation.title} layerClassName="git-operation-backdrop" onClose={onClose} maximizable>
      <div className="git-operation-modal selecting" role="dialog" aria-modal="false" aria-label={operation.title}>
        <div className="git-operation-targets">
          <div className="git-operation-copy"><span className="panel-kicker">Operação Git</span><strong>{operation.title}</strong><p>{operation.detail}</p></div>
          <div className="git-operation-target-toolbar"><span>{selected.size} de {availableTargets.length} selecionado(s)</span><div><button type="button" onClick={() => setSelected(new Set(availableTargets.map((target) => target.path)))} disabled={selected.size === availableTargets.length}>Todos</button><button type="button" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Nenhum</button></div></div>
          <ul className="git-operation-target-list" aria-label="Repositórios para a operação">{(operation.targets || []).map((target) => { const enabled = target.available !== false; const detail = target.detail ? `${target.branch} · ${target.detail}` : target.branch; return <li key={target.path || '__root__'}><label className={enabled ? '' : 'disabled'}><input type="checkbox" aria-label={`Executar em ${target.label}`} disabled={!enabled} checked={selected.has(target.path)} onChange={() => setSelected((current) => toggleTarget(current, target.path))}/><span className="git-operation-target-copy"><strong title={target.label}>{target.label}</strong><small title={detail}>{detail}</small></span><span className="git-operation-target-meta" aria-label={`${target.ahead || 0} para enviar e ${target.behind || 0} para receber`}><b title={`${target.ahead || 0} commit(s) para enviar`}>↑{target.ahead || 0}</b><b title={`${target.behind || 0} commit(s) para receber`}>↓{target.behind || 0}</b></span></label></li> })}</ul>
          <div className="git-operation-target-actions"><button type="button" className="git-action" onClick={onClose}>Cancelar</button><button type="button" className="git-action primary" disabled={selected.size === 0} onClick={() => operation.onConfirmTargets?.(Array.from(selected))}>Continuar ({selected.size})</button></div>
        </div>
      </div>
    </InternalWindow>
  }

  const statusSteps: Array<{ label: string; detail: string; state: GitOperationStepState }> = [
    {
      label: operation.phase === 'preparing' ? 'Analisar' : 'Processar',
      detail: operation.phase === 'preparing' ? 'Calcular diferenças antes da ação' : 'Executar a ação Git pedida',
      state: operation.phase === 'running' || operation.phase === 'preparing'
        ? 'active'
        : operation.phase === 'error' && (operation.failedPhase === 'running' || operation.failedPhase === 'preparing') ? 'error' : 'done',
    },
    {
      label: 'Sincronizar',
      detail: 'Atualizar o estado apresentado',
      state: operation.phase === 'refreshing' ? 'active' : success ? 'done' : operation.phase === 'error' && operation.failedPhase === 'refreshing' ? 'error' : 'idle',
    },
    {
      label: 'Resultado',
      detail: phaseLabel,
      state: success ? 'done-active' : operation.phase === 'error' ? 'error' : 'idle',
    },
  ]
  const symbolClassName = success
    ? 'grid h-12 w-12 place-items-center rounded-2xl border border-whx-border bg-whx-surface text-[color:var(--success)] shadow-sm max-[560px]:h-11 max-[560px]:w-11'
    : operation.phase === 'error'
      ? 'grid h-12 w-12 place-items-center rounded-2xl border border-whx-border bg-whx-surface text-whx-warning shadow-sm max-[560px]:h-11 max-[560px]:w-11'
      : 'grid h-12 w-12 place-items-center rounded-2xl border border-whx-border bg-[var(--theme-accent-soft)] text-[color:var(--theme-accent)] shadow-sm max-[560px]:h-11 max-[560px]:w-11'
  const progressClassName = operation.phase === 'error'
    ? 'h-full rounded-full bg-[var(--theme-warning,var(--theme-accent))]'
    : 'h-full rounded-full bg-[var(--theme-accent)]'
  const progressWidthClassName = operation.phase === 'preparing' || operation.phase === 'running'
    ? 'w-1/3 animate-pulse motion-reduce:animate-none'
    : operation.phase === 'refreshing' ? 'w-2/3 animate-pulse motion-reduce:animate-none' : 'w-full'
  const messageClassName = operation.phase === 'error'
    ? 'col-span-full m-0 rounded-xl border border-whx-border bg-whx-surface px-3.5 py-3 text-[calc(7.8px_*_var(--ui-font-scale))] leading-[1.45] text-whx-warning'
    : 'col-span-full m-0 rounded-xl border border-whx-border bg-whx-surface px-3.5 py-3 text-[calc(7.8px_*_var(--ui-font-scale))] leading-[1.45] text-whx-muted'

  return <InternalWindow title={operation.title} layerClassName="git-operation-backdrop" onClose={onClose} closeDisabled={running} maximizable>
    <section className="isolate grid w-[min(660px,calc(100vw-32px))] max-h-[calc(100vh-32px)] grid-cols-[48px_minmax(0,1fr)] gap-x-4 gap-y-4 overflow-hidden rounded-2xl border border-whx-border bg-whx-elevated p-5 text-whx-text shadow-[0_28px_80px_var(--theme-shadow)] max-[560px]:w-[calc(100vw-20px)] max-[560px]:grid-cols-[44px_minmax(0,1fr)] max-[560px]:gap-x-3 max-[560px]:gap-y-3 max-[560px]:p-4" role="dialog" aria-modal="false" aria-label={operation.title}>
      <div className={symbolClassName} aria-hidden="true">{running
        ? <span className="h-5 w-5 animate-spin rounded-full motion-reduce:animate-none border-2 border-whx-border [border-top-color:var(--theme-accent)]"/>
        : <Icon name={success ? 'check' : 'alert'} size={20}/>}</div>
      <div className="min-w-0 self-center pr-[104px] max-[720px]:pr-[78px] max-[560px]:pr-[72px]">
        <span className="mb-1 block text-[calc(6.6px_*_var(--ui-font-scale))] font-bold uppercase tracking-[0.14em] text-whx-muted">Operação Git</span>
        <strong className="block [overflow-wrap:anywhere] text-[calc(11.7px_*_var(--ui-font-scale))] font-semibold leading-[1.25] tracking-[-0.015em] text-whx-text">{operation.title}</strong>
        <p className="mb-0 mt-1 [overflow-wrap:anywhere] text-[calc(7.8px_*_var(--ui-font-scale))] leading-[1.45] text-whx-muted">{operation.detail}</p>
      </div>
      <div className="col-span-full flex items-center gap-3" aria-hidden="true">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--theme-muted)]"><i className={`${progressClassName} ${progressWidthClassName} block`}/></div>
        <span className="shrink-0 text-[calc(6.9px_*_var(--ui-font-scale))] font-semibold text-whx-muted">{success ? 'Concluído' : operation.phase === 'error' ? 'Interrompido' : 'Em curso'}</span>
      </div>
      <ol className="col-span-full m-0 grid list-none grid-cols-3 gap-2 p-0 max-[560px]:grid-cols-1" aria-label="Progresso da operação">
        {statusSteps.map((step, index) => <li key={step.label} className={gitOperationStepClassName(step.state)}>
          <span className={gitOperationStepMarkerClassName(step.state)}>{index + 1}</span>
          <div className="min-w-0">
            <strong className="block text-[calc(7.5px_*_var(--ui-font-scale))] font-semibold leading-[1.3] text-whx-text">{step.label}</strong>
            <small className="mt-0.5 block [overflow-wrap:anywhere] text-[calc(6.5px_*_var(--ui-font-scale))] leading-[1.35] text-whx-muted">{step.detail}</small>
          </div>
        </li>)}
      </ol>
      {(operation.message || running) && <p className={messageClassName} aria-live="polite">{operation.message || phaseLabel}</p>}
      {!running && <div className="col-span-full flex justify-end border-t border-whx-border pt-3"><button type="button" className="rounded-lg border border-whx-border bg-whx-surface px-4 py-2 text-[calc(7.7px_*_var(--ui-font-scale))] font-bold text-whx-text shadow-sm transition hover:bg-whx-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--theme-accent)]" onClick={onClose}>Fechar</button></div>}
    </section>
  </InternalWindow>
}

type GitOperationStepState = 'idle' | 'active' | 'done' | 'done-active' | 'error'

function gitOperationStepClassName(state: GitOperationStepState) {
  if (state === 'active' || state === 'done-active') return 'grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-xl border border-whx-border bg-[var(--theme-accent-soft)] p-2.5 opacity-100'
  if (state === 'error') return 'grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-xl border border-whx-border bg-whx-surface p-2.5 opacity-100'
  if (state === 'done') return 'grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-xl border border-whx-border bg-whx-surface p-2.5 opacity-100'
  return 'grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-xl border border-whx-border bg-[var(--theme-bg)] p-2.5 opacity-55'
}

function gitOperationStepMarkerClassName(state: GitOperationStepState) {
  if (state === 'active' || state === 'done-active') return 'grid h-6 w-6 place-items-center rounded-full bg-[var(--theme-accent)] font-mono text-[calc(6.8px_*_var(--ui-font-scale))] font-bold leading-none text-[color:var(--theme-bg)]'
  if (state === 'error') return 'grid h-6 w-6 place-items-center rounded-full bg-[var(--theme-muted)] font-mono text-[calc(6.8px_*_var(--ui-font-scale))] font-bold leading-none text-whx-warning'
  if (state === 'done') return 'grid h-6 w-6 place-items-center rounded-full bg-[var(--theme-muted)] font-mono text-[calc(6.8px_*_var(--ui-font-scale))] font-bold leading-none text-[color:var(--success)]'
  return 'grid h-6 w-6 place-items-center rounded-full bg-[var(--theme-muted)] font-mono text-[calc(6.8px_*_var(--ui-font-scale))] font-bold leading-none text-whx-muted'
}

function initialSelection(operation: GitOperation) {
  const allowed = (operation.targets || []).filter((target) => target.available !== false).map((target) => target.path)
  return new Set(operation.defaultTargets?.length ? operation.defaultTargets.filter((path) => allowed.includes(path)) : allowed)
}

function toggleTarget(current: Set<string>, path: string) { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next }
