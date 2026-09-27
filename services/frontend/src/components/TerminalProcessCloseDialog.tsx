import { Icon } from './Icon'

type Props = {
  count: number
  subject: string
  busy?: boolean
  error?: string
  onKeep: () => void
  onTerminate: () => void
  onCancel: () => void
}

export function TerminalProcessCloseDialog({ count, subject, busy = false, error = '', onKeep, onTerminate, onCancel }: Props) {
  return <section className="desktop-close-dialog" role="alertdialog" aria-modal="true" aria-labelledby="terminal-close-title" aria-describedby="terminal-close-description">
    <header className="desktop-close-heading">
      <span className="desktop-close-symbol"><Icon name="terminal" size={20}/></span>
      <div><span className="desktop-close-kicker">Terminal ativo</span><h2 id="terminal-close-title">Há {count} processo{count === 1 ? '' : 's'} em execução</h2></div>
      <button type="button" className="desktop-close-dismiss" disabled={busy} onClick={onCancel} aria-label="Cancelar fechamento" title="Cancelar"><Icon name="close" size={15}/></button>
    </header>
    <p id="terminal-close-description" className="desktop-close-description">Antes de fechar {subject}, escolha o que fazer com os processos de terminal Host em execução.</p>
    <div className="desktop-close-options">
      <button type="button" className="desktop-close-option recommended" disabled={busy} onClick={onKeep}>
        <span className="desktop-close-option-icon"><Icon name="archive" size={18}/></span>
        <span><strong>Manter em background</strong><small>Mantém os processos ativos e os IDs guardados para tentar recuperá-los quando o projeto voltar a abrir.</small></span>
        <em>Recomendado</em>
      </button>
      <button type="button" className="desktop-close-option danger" disabled={busy} onClick={onTerminate}>
        <span className="desktop-close-option-icon"><Icon name="close" size={18}/></span>
        <span><strong>Encerrar processos de terminal</strong><small>Encerra todos os processos de terminal desta operação antes de fechar.</small></span>
        <Icon name="chevron-right" size={15}/>
      </button>
    </div>
    {error && <p className="desktop-close-error" role="status"><Icon name="alert" size={14}/>{error}</p>}
    <footer><span><Icon name="info" size={13}/> Cancelar mantém a janela ou projeto aberto.</span><button type="button" disabled={busy} onClick={onCancel}>Cancelar</button></footer>
  </section>
}
