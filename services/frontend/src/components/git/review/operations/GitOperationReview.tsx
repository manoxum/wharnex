import { useState } from 'react'
import type { GitOperation } from './operationTypes'
import { GitDiffReview } from '../GitDiffReview'
import { Button, EmptyState, Field, Input, StatusBadge } from '../../../presentation/workbench'
import { WorkbenchTabs } from '../../../presentation/tabs'
import { Icon } from '../../../presentation/chrome/Icon'
import { WindowPanelHeader } from '../../../workspace/window/chrome'

export function GitOperationReview({ operation, sessionId, onClose }: { operation: GitOperation; sessionId: string; onClose: () => void }) {
  const [activePreview, setActivePreview] = useState('0')
  const [message, setMessage] = useState('')
  const previews = operation.previews || []
  const preview = previews[Math.min(Number(activePreview), Math.max(0, previews.length - 1))]
  return <>
      <WindowPanelHeader closeLabel="Fechar revisão" icon="git" title={operation.title} description={`Revisão antes de executar · ${operation.detail}`} onClose={onClose}/>
      {operation.reviewMessage && <p className="!m-0 border-b border-whx-border-soft bg-whx-surface px-4 py-3 !text-whx-label !leading-relaxed !text-whx-soft" role="status">{operation.reviewMessage}</p>}
      {operation.quickCommit && <section className="border-b border-whx-border-soft bg-whx-surface px-4 py-3" aria-label="Commit rápido antes do push">
        <div className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1"><Field label="Commit rápido antes do push" description={`${operation.quickCommit.fileCount} alteração(ões) em ${operation.quickCommit.repositoryCount} repositório(s). O diff será recalculado antes da confirmação final.`}><Input aria-label="Mensagem do commit rápido" placeholder="Descreva as alterações…" value={message} onChange={(event) => setMessage(event.target.value)}/></Field></div><Button disabled={!message.trim() || Boolean(operation.quickCommit.unavailableReason)} onClick={() => operation.quickCommit?.onCommit(message.trim())}>Commit rápido</Button></div>
        {operation.quickCommit.unavailableReason && <p className="!mb-0 !mt-2 !text-whx-label !text-whx-warning" role="alert">{operation.quickCommit.unavailableReason}</p>}
      </section>}
      {previews.length > 1 && <nav aria-label="Repositórios revistos"><WorkbenchTabs label="Repositórios revistos" value={activePreview} onChange={setActivePreview} items={previews.map((item, index) => ({ id: String(index), label: `${item.repository || 'Projeto principal'} · ${item.to_label}`, icon: 'git' }))}/></nav>}
      {preview ? <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-whx-border-soft px-4 py-2 text-whx-caption text-whx-faint"><span><b className="font-medium text-whx-soft">Antes:</b> {preview.from_label}</span><Icon name="arrow-right" size={13}/><span><b className="font-medium text-whx-soft">Depois:</b> {preview.to_label}</span>{preview.truncated && <StatusBadge tone="warning" icon="info">Diff limitado a 2 MiB</StatusBadge>}</div>
        <div className="relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden"><GitDiffReview sessionId={sessionId} diff={preview.diff} emptyText="Não há diferenças de conteúdo para esta operação." fragmentOnly/></div>
      </div> : <EmptyState icon="git" title="Sem alterações para rever" description="Esta operação não apresenta diferenças de conteúdo."/>}
      <footer className="relative z-10 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-whx-border-soft bg-whx-surface px-4 py-3" data-internal-window-no-drag>
        <span className="mr-auto text-whx-caption text-whx-faint">Reveja as alterações antes de continuar.</span><Button onClick={onClose}>Cancelar</Button><Button tone="primary" className="pointer-events-auto" onClick={() => operation.onConfirmReview?.()}>Confirmar e continuar</Button>
      </footer>
  </>
}
