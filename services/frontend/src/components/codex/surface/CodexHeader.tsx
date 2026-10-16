import type { CodexStatus } from '../../../lib/codex'
import { Icon } from '../../presentation/chrome/Icon'
import { Button, IconButton, PanelHeader, StatusBadge } from '../../presentation/workbench'

export function CodexHeader({ status, loading, available, onRefresh, onAccountAction }: {
  status?: CodexStatus; loading: boolean; available: boolean
  onRefresh: () => void; onAccountAction: (action: 'login' | 'logout') => void
}) {
  const account = status?.account || status?.accounts?.profiles.find((profile) => profile.id === status.accounts?.selected)?.account
  const connected = Boolean(status?.connected)
  const accountLabel = account?.email || (connected ? 'Conta ligada' : account ? 'Conta Codex guardada' : loading ? 'A verificar conta…' : !status ? 'Conta indisponível' : available ? 'Ligue a sua conta para começar' : 'Disponível no Wharnex Desktop')
  return <div className="shrink-0 border-b border-whx-border-soft">
    <PanelHeader title="Codex" description="Agente local" icon="code" actions={<><IconButton label="Atualizar Codex" title="Atualizar conta e consumo" icon="refresh" disabled={loading} onClick={onRefresh}/>{account || connected ? <Button tone="quiet" onClick={() => onAccountAction('logout')}>Sair</Button> : status && !loading && <Button disabled={!available} onClick={() => onAccountAction('login')}>Entrar no Codex</Button>}</>}/>
    <div className="flex min-w-0 flex-wrap items-center gap-2 px-4 py-3">
      <StatusBadge tone={connected ? 'success' : 'neutral'} icon={connected ? 'check' : 'network'}>{connected ? 'Ligado' : loading ? 'A ligar…' : 'Sem ligação'}</StatusBadge>
      <span className="min-w-0 flex-1 truncate text-whx-label text-whx-soft" title={account?.email}>{accountLabel}</span>
      {account?.planType && <StatusBadge>{account.planType}</StatusBadge>}
    </div>
    <p className="!m-0 flex items-start gap-2 px-4 pb-3 !text-whx-caption !leading-relaxed !text-whx-faint"><span className="mt-0.5 shrink-0"><Icon name="monitor" size={14}/></span>Acesso direto ao computador · pode executar comandos e alterar ficheiros.</p>
  </div>
}
