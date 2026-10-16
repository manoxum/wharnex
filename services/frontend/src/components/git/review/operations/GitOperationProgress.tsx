import { Icon } from '../../../presentation/chrome/Icon'
import type { GitOperation } from './operationTypes'

export function GitOperationProgress({ operation, onClose }: { operation: GitOperation; onClose: () => void }) {
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
    ? 'grid h-12 w-12 place-items-center rounded-2xl border border-whx-border bg-whx-surface text-whx-success shadow-sm max-[560px]:h-11 max-[560px]:w-11'
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
    ? 'col-span-full m-0 rounded-xl border border-whx-border bg-whx-surface px-3.5 py-3 text-whx-caption leading-[1.45] text-whx-warning'
    : 'col-span-full m-0 rounded-xl border border-whx-border bg-whx-surface px-3.5 py-3 text-whx-caption leading-[1.45] text-whx-faint'

  return <>
      <div className={symbolClassName} aria-hidden="true">{running
        ? <span className="h-5 w-5 animate-spin rounded-full motion-reduce:animate-none border-2 border-whx-border [border-top-color:var(--theme-accent)]"/>
        : <Icon name={success ? 'check' : 'alert'} size={20}/>}</div>
      <div className="min-w-0 self-center pr-[104px] max-[720px]:pr-[78px] max-[560px]:pr-[72px]">
        <span className="mb-1 block text-whx-caption font-bold uppercase tracking-[0.14em] text-whx-faint">Operação Git</span>
        <strong className="block [overflow-wrap:anywhere] text-whx-title font-semibold leading-[1.25] tracking-[-0.015em] text-whx-text">{operation.title}</strong>
        <p className="mb-0 mt-1 [overflow-wrap:anywhere] text-whx-caption leading-[1.45] text-whx-faint">{operation.detail}</p>
      </div>
      <div className="col-span-full flex items-center gap-3" aria-hidden="true">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--theme-muted)]"><i className={`${progressClassName} ${progressWidthClassName} block`}/></div>
        <span className="shrink-0 text-whx-caption font-semibold text-whx-faint">{success ? 'Concluído' : operation.phase === 'error' ? 'Interrompido' : 'Em curso'}</span>
      </div>
      <ol className="col-span-full m-0 grid list-none grid-cols-3 gap-2 p-0 max-[560px]:grid-cols-1" aria-label="Progresso da operação">
        {statusSteps.map((step, index) => <li key={step.label} className={gitOperationStepClassName(step.state)}>
          <span className={gitOperationStepMarkerClassName(step.state)}>{index + 1}</span>
          <div className="min-w-0">
            <strong className="block text-whx-caption font-semibold leading-[1.3] text-whx-text">{step.label}</strong>
            <small className="mt-0.5 block [overflow-wrap:anywhere] text-whx-caption leading-[1.35] text-whx-faint">{step.detail}</small>
          </div>
        </li>)}
      </ol>
      {(operation.message || running) && <p className={messageClassName} aria-live="polite">{operation.message || phaseLabel}</p>}
      {!running && <div className="col-span-full flex justify-end border-t border-whx-border pt-3"><button type="button" className="rounded-lg border border-whx-border bg-whx-surface px-4 py-2 text-whx-caption font-bold text-whx-text shadow-sm transition hover:bg-whx-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--theme-accent)]" onClick={onClose}>Fechar</button></div>}
  </>
}

type GitOperationStepState = 'idle' | 'active' | 'done' | 'done-active' | 'error'

function gitOperationStepClassName(state: GitOperationStepState) {
  if (state === 'active' || state === 'done-active') return 'grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-xl border border-whx-border bg-[var(--theme-accent-soft)] p-2.5 opacity-100'
  if (state === 'error') return 'grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-xl border border-whx-border bg-whx-surface p-2.5 opacity-100'
  if (state === 'done') return 'grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-xl border border-whx-border bg-whx-surface p-2.5 opacity-100'
  return 'grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-xl border border-whx-border bg-[var(--theme-bg)] p-2.5 opacity-55'
}

function gitOperationStepMarkerClassName(state: GitOperationStepState) {
  if (state === 'active' || state === 'done-active') return 'grid h-6 w-6 place-items-center rounded-full bg-[var(--theme-accent)] font-mono text-whx-caption font-bold leading-none text-[color:var(--theme-bg)]'
  if (state === 'error') return 'grid h-6 w-6 place-items-center rounded-full bg-[var(--theme-muted)] font-mono text-whx-caption font-bold leading-none text-whx-warning'
  if (state === 'done') return 'grid h-6 w-6 place-items-center rounded-full bg-[var(--theme-muted)] font-mono text-whx-caption font-bold leading-none text-whx-success'
  return 'grid h-6 w-6 place-items-center rounded-full bg-[var(--theme-muted)] font-mono text-whx-caption font-bold leading-none text-whx-faint'
}
