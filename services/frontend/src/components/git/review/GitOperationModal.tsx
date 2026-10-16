import { InternalWindow } from '../../workspace/window/InternalWindow'
import { GitOperationReview, GitOperationProgress, GitOperationSelecting, gitOperationSurface, type GitOperation } from './operations'
export type { GitOperation, GitOperationPhase, GitOperationTarget } from './operations'

export function GitOperationModal({ operation, sessionId = '', onClose }: { operation: GitOperation; sessionId?: string; onClose: () => void }) {
  const reviewing = operation.phase === 'reviewing'
  const running = operation.phase === 'preparing' || operation.phase === 'running' || operation.phase === 'refreshing'
  return <InternalWindow title={operation.title} layerClassName="git-operation-backdrop" onClose={onClose} closeDisabled={running} maximizable controlsInHeader={reviewing || operation.phase === 'selecting'} closeLabel={reviewing ? 'Fechar revisão' : `Fechar ${operation.title}`}>
    <section className={gitOperationSurface(operation.phase)} role="dialog" aria-modal="false" aria-label={operation.title}>
      {reviewing ? <GitOperationReview operation={operation} sessionId={sessionId} onClose={onClose}/>
        : operation.phase === 'selecting' ? <GitOperationSelecting operation={operation} onClose={onClose}/>
          : <GitOperationProgress operation={operation} onClose={onClose}/>}
    </section>
  </InternalWindow>
}
