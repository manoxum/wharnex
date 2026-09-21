import { Icon } from './Icon'
import { InternalWindow } from './InternalWindow'

export type GitOperationPhase = 'running' | 'refreshing' | 'success' | 'error'
export type GitOperation = {
  title: string
  detail: string
  phase: GitOperationPhase
  message?: string
  failedPhase?: 'running' | 'refreshing'
}

export function GitOperationModal({ operation, onClose }: { operation: GitOperation; onClose: () => void }) {
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
      <div className="git-operation-symbol" aria-hidden="true">
        {running ? <span className="git-operation-spinner"/> : <Icon name={success ? 'check' : 'alert'} size={19}/>}
      </div>
      <div className="git-operation-copy">
        <span className="panel-kicker">Operação Git</span>
        <strong>{operation.title}</strong>
        <p>{operation.detail}</p>
      </div>
      <div className="git-operation-progress" aria-hidden="true"><i className={running ? 'active' : 'complete'}/></div>
      <ol className="git-operation-steps" aria-label="Progresso da operação">
        <li className={operation.phase === 'running' ? 'active' : operation.phase === 'error' && operation.failedPhase === 'running' ? 'error active' : 'done'}><span>1</span><div><strong>Processar</strong><small>Executar a ação Git pedida</small></div></li>
        <li className={operation.phase === 'refreshing' ? 'active' : success ? 'done' : operation.phase === 'error' && operation.failedPhase === 'refreshing' ? 'error active' : ''}><span>2</span><div><strong>Sincronizar</strong><small>Atualizar o estado apresentado</small></div></li>
        <li className={success ? 'done active' : operation.phase === 'error' ? 'error active' : ''}><span>3</span><div><strong>Resultado</strong><small>{phaseLabel}</small></div></li>
      </ol>
      {(operation.message || running) && <p className="git-operation-message" aria-live="polite">{operation.message || phaseLabel}</p>}
      {!running && <button type="button" className="git-action primary git-operation-close" onClick={onClose}>Fechar</button>}
    </div>
  </InternalWindow>
}
