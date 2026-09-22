import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { InternalWindow } from './InternalWindow'

export type GitOperationPhase = 'selecting' | 'running' | 'refreshing' | 'success' | 'error'
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
  failedPhase?: 'running' | 'refreshing'
  targets?: GitOperationTarget[]
  defaultTargets?: string[]
  onConfirmTargets?: (paths: string[]) => void
}

export function GitOperationModal({ operation, onClose }: { operation: GitOperation; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(() => initialSelection(operation))
  useEffect(() => {
    const allowed = (operation.targets || []).filter((target) => target.available !== false).map((target) => target.path)
    setSelected(new Set(operation.defaultTargets?.length ? operation.defaultTargets.filter((path) => allowed.includes(path)) : allowed))
  }, [operation])

  const selecting = operation.phase === 'selecting'
  const running = operation.phase === 'running' || operation.phase === 'refreshing'
  const success = operation.phase === 'success'
  const phaseLabel = operation.phase === 'running'
    ? 'A executar operação Git…'
    : operation.phase === 'refreshing'
      ? 'A atualizar o estado do projeto…'
      : success
        ? 'Operação concluída'
        : operation.failedPhase === 'refreshing'
          ? 'A ação terminou, mas o painel não foi atualizado'
          : 'A operação Git falhou'

  return <InternalWindow title={operation.title} layerClassName="git-operation-backdrop" onClose={onClose} closeDisabled={running}>
    <div className={`git-operation-modal ${operation.phase}`} role="dialog" aria-modal="false" aria-label={operation.title}>
      {selecting ? <div className="git-operation-targets">
        <div className="git-operation-copy"><span className="panel-kicker">Operação Git</span><strong>{operation.title}</strong><p>{operation.detail}</p></div>
        <ul className="git-operation-target-list" aria-label="Repositórios para a operação">{(operation.targets || []).map((target) => {
          const enabled = target.available !== false
          return <li key={target.path || '__root__'}><label className={enabled ? '' : 'disabled'}>
            <input type="checkbox" aria-label={`Executar em ${target.label}`} disabled={!enabled} checked={selected.has(target.path)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(target.path)) next.delete(target.path); else next.add(target.path); return next })}/>
            <span className="git-operation-target-copy"><strong>{target.label}</strong><small>{target.branch}{target.detail ? ` · ${target.detail}` : ''}</small></span>
            <span className="git-operation-target-meta"><b>↑{target.ahead || 0}</b><b>↓{target.behind || 0}</b></span>
          </label></li>
        })}</ul>
        <div className="git-operation-target-actions"><button type="button" className="git-action" onClick={onClose}>Cancelar</button><button type="button" className="git-action primary" disabled={selected.size === 0} onClick={() => operation.onConfirmTargets?.(Array.from(selected))}>Continuar ({selected.size})</button></div>
      </div> : <>
        <div className="git-operation-symbol" aria-hidden="true">
          {running ? <span className="git-operation-spinner"/> : <Icon name={success ? 'check' : 'alert'} size={19}/>}
        </div>
        <div className="git-operation-copy"><span className="panel-kicker">Operação Git</span><strong>{operation.title}</strong><p>{operation.detail}</p></div>
        <div className="git-operation-progress" aria-hidden="true"><i className={running ? 'active' : 'complete'}/></div>
        <ol className="git-operation-steps" aria-label="Progresso da operação">
          <li className={operation.phase === 'running' ? 'active' : operation.phase === 'error' && operation.failedPhase === 'running' ? 'error active' : 'done'}><span>1</span><div><strong>Processar</strong><small>Executar a ação Git pedida</small></div></li>
          <li className={operation.phase === 'refreshing' ? 'active' : success ? 'done' : operation.phase === 'error' && operation.failedPhase === 'refreshing' ? 'error active' : ''}><span>2</span><div><strong>Sincronizar</strong><small>Atualizar o estado apresentado</small></div></li>
          <li className={success ? 'done active' : operation.phase === 'error' ? 'error active' : ''}><span>3</span><div><strong>Resultado</strong><small>{phaseLabel}</small></div></li>
        </ol>
        {(operation.message || running) && <p className="git-operation-message" aria-live="polite">{operation.message || phaseLabel}</p>}
        {!running && <button type="button" className="git-action primary git-operation-close" onClick={onClose}>Fechar</button>}
      </>}
    </div>
  </InternalWindow>
}

function initialSelection(operation: GitOperation) {
  const allowed = (operation.targets || []).filter((target) => target.available !== false).map((target) => target.path)
  return new Set(operation.defaultTargets?.length ? operation.defaultTargets.filter((path) => allowed.includes(path)) : allowed)
}
