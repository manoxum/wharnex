import { ConfirmationDialog } from '../../presentation/dialogs'
type Props = { count: number; subject: string; busy?: boolean; error?: string; onKeep: () => void; onTerminate: () => void; onCancel: () => void }
export function TerminalProcessCloseDialog({ count, subject, busy = false, error = '', onKeep, onTerminate, onCancel }: Props) {
  return <ConfirmationDialog title={`Há ${count} processo${count === 1 ? '' : 's'} em execução`} description={`Antes de fechar ${subject}, escolha o que fazer com os processos de terminal Host em execução.`} icon="terminal" busy={busy} error={error} onCancel={onCancel} actions={[
    { label: 'Manter em background', description: 'Mantém os processos ativos e os IDs guardados para tentar recuperá-los quando o projeto voltar a abrir.', icon: 'archive', run: onKeep },
    { label: 'Encerrar processos de terminal', description: 'Encerra todos os processos de terminal desta operação antes de fechar.', tone: 'danger', icon: 'close', run: onTerminate },
  ]}/>
}
