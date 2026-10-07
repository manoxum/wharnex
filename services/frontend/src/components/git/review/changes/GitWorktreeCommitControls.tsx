import { Icon } from '../../../presentation/chrome/Icon'

export type CollectiveCommitControls = {
  repositoryCount: number
  commitReason: string
  pushReason: string
  onCommitAll: () => void
  onCommitPush: () => void
}

const button = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-whx-border bg-whx-elevated px-3 py-1.5 text-sm! font-semibold! text-whx-text transition hover:bg-whx-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--theme-accent)] disabled:cursor-default disabled:opacity-45'

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
  return <div className="grid min-w-0 gap-2 rounded-lg border border-whx-border bg-whx-surface p-2">
    <label className="grid min-w-0 gap-1 text-xs font-semibold text-whx-faint">
      <span>Mensagem do commit</span>
      <input type="text" value={message} disabled={disabled || !identityReady} onChange={(event) => onMessageChange(event.target.value)} placeholder="ex.: fix(ui): ajustar painel Git" className="h-8 w-full min-w-0 rounded-md border border-whx-border bg-whx-bg px-2.5 text-sm! font-normal! text-whx-text outline-none focus:border-[var(--theme-accent)] focus:ring-1 focus:ring-[var(--theme-accent)]"/>
    </label>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Criar commits e publicar alterações">
      <button type="button" className={button} disabled={!ready || !identityReady || selectedCount === 0} onClick={onCommit}><Icon name="check" size={13}/>Commitar ({selectedCount})</button>
      {collective && <>
        <button type="button" className={button} disabled={!ready || Boolean(collective.commitReason)} title={collective.commitReason || `Commitar todas as alterações em ${collective.repositoryCount} repositório(s)`} onClick={collective.onCommitAll}><Icon name="git" size={13}/>Commitar tudo</button>
        <button type="button" className={`${button} bg-[var(--theme-accent-soft)]`} disabled={!ready || Boolean(collective.commitReason || collective.pushReason)} title={collective.commitReason || collective.pushReason || 'Criar os commits e rever o envio para os remotos'} onClick={collective.onCommitPush}><Icon name="arrow-up" size={13}/>Commit e push</button>
      </>}
    </div>
    {collective && <p className="m-0 text-xs text-whx-faint">{collective.commitReason || collective.pushReason || `A mesma mensagem será usada em ${collective.repositoryCount} repositório(s). Commit e push permite rever o envio após criar os commits.`}</p>}
  </div>
}
