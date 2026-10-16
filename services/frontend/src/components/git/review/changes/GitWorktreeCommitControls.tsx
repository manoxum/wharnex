import { Button, Input } from '../../../presentation/workbench'

export type CollectiveCommitControls = {
  repositoryCount: number
  commitReason: string
  pushReason: string
  onCommitAll: () => void
  onCommitPush: () => void
}

export function GitWorktreeCommitControls({ disabled, identityReady, selectedCount, message, onMessageChange, onCommit, collective }: {
  disabled: boolean
  identityReady: boolean
  selectedCount: number
  message: string
  onMessageChange: (message: string) => void
  onCommit: () => void
  collective?: CollectiveCommitControls
}) {
  const ready = !disabled && Boolean(message.trim())
  return <div className="grid min-w-0 gap-3 border-t border-whx-border-soft pt-3">
    <label className="grid min-w-0 gap-1.5 text-whx-label font-medium text-whx-soft">
      <span>Mensagem do commit</span>
      <Input type="text" value={message} disabled={disabled || !identityReady} onChange={(event) => onMessageChange(event.target.value)} placeholder="ex.: fix(ui): ajustar painel Git" className="!h-9 !w-full"/>
    </label>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Criar commits e publicar alterações">
      <Button icon="check" disabled={!ready || !identityReady || selectedCount === 0} onClick={onCommit}>Commitar ({selectedCount})</Button>
      {collective && <>
        <Button icon="git" disabled={!ready || Boolean(collective.commitReason)} title={collective.commitReason || `Commitar todas as alterações em ${collective.repositoryCount} repositório(s)`} onClick={collective.onCommitAll}>Commitar tudo</Button>
        <Button icon="arrow-up" disabled={!ready || Boolean(collective.commitReason || collective.pushReason)} title={collective.commitReason || collective.pushReason || 'Criar os commits e rever o envio para os remotos'} onClick={collective.onCommitPush}>Commit e push</Button>
      </>}
    </div>
    {collective && <p className="m-0 text-whx-caption leading-relaxed text-whx-faint">{collective.commitReason || collective.pushReason || `A mesma mensagem será usada em ${collective.repositoryCount} repositório(s). Commit e push permite rever o envio após criar os commits.`}</p>}
  </div>
}
