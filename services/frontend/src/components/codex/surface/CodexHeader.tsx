import type { CodexStatus } from '../../../lib/codex'
import { Icon } from '../../presentation/chrome/Icon'
import { codexButton } from '../presentation'

export function CodexHeader({ status, loading, available, onRefresh, onAccountAction }: {
  status?: CodexStatus; loading: boolean; available: boolean
  onRefresh: () => void; onAccountAction: (action: 'login' | 'logout') => void
}) {
  const connected = Boolean(status?.connected && status.account)
  return <header className="shrink-0 border-b border-whx-border-soft px-4 pb-3 pt-4">
    <div className="flex flex-wrap items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-whx-accent/20 bg-whx-accent-soft text-whx-accent"><Icon name="code" size={22}/></span>
      <div className="min-w-0 flex-1"><h2 className="m-0 text-xl font-semibold tracking-tight">Codex</h2><p className="m-0 mt-0.5 text-[calc(10px*var(--ui-font-scale))] text-whx-faint">Agente local</p></div>
      <button type="button" className={`${codexButton} !size-8 !p-0`} disabled={loading} onClick={onRefresh} aria-label="Atualizar Codex" title="Atualizar conta e consumo"><Icon name="refresh" size={15}/></button>
      {status?.account ? <button type="button" className={codexButton} title="Termina a sessão Codex partilhada com a CLI e a extensão" onClick={() => onAccountAction('logout')}>Sair</button>
        : <button type="button" className={codexButton} disabled={loading || !available} onClick={() => onAccountAction('login')}>Entrar no Codex</button>}
    </div>
    <div className="mt-4 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-[calc(10px*var(--ui-font-scale))]">
      <span className={`inline-flex shrink-0 items-center gap-1.5 ${connected ? 'text-whx-success' : 'text-whx-faint'}`}><span className={`size-1.5 rounded-full ${connected ? 'bg-whx-success' : 'bg-whx-border'}`}/>{connected ? 'Ligado' : loading ? 'A ligar…' : 'Sem ligação'}</span>
      <span aria-hidden="true" className="text-whx-border">/</span>
      <span className="min-w-0 flex-1 truncate text-whx-soft" title={status?.account?.email}>{status?.account ? status.account.email || 'Conta Codex ligada' : 'Ligue a sua conta para começar'}</span>
      {status?.account?.planType && <span className="rounded border border-whx-border-soft px-1.5 py-0.5 text-[calc(9px*var(--ui-font-scale))] font-medium uppercase text-whx-faint">{status.account.planType}</span>}
    </div>
    <p className="mb-0 mt-3 flex items-start gap-2 text-[calc(10px*var(--ui-font-scale))] leading-5 text-whx-faint"><span className="mt-0.5 shrink-0"><Icon name="monitor" size={14}/></span>Acesso direto ao computador · pode executar comandos e alterar ficheiros.</p>
  </header>
}
