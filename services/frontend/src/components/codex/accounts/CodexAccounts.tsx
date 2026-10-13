import { useState } from 'react'
import type { CodexStatus } from '../../../lib/codex'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { codexButton } from '../presentation'

export function CodexAccounts({ projectPath, accounts, refresh }: { projectPath: string; accounts?: CodexStatus['accounts']; refresh: () => Promise<unknown> }) {
  const [adding, setAdding] = useState(false), [label, setLabel] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await action(); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível mudar de conta.'); await refresh().catch(() => {}) }
    finally { setBusy(false) }
  }
  if (!accounts) return null
  return <section aria-label="Contas Codex" className="shrink-0 border-b border-whx-border-soft px-4 py-3 text-[calc(10px*var(--ui-font-scale))]">
    <div className="flex items-center gap-2"><label className="min-w-0 flex-1">Conta<select aria-label="Conta Codex" disabled={busy} value={accounts.selected}
      className="!mt-1 !w-full !min-w-0 !rounded-lg !border !border-whx-border-soft !bg-whx-muted !p-2 !text-[calc(10px*var(--ui-font-scale))] !text-whx-text"
      onChange={(event) => { const id = event.target.value; void run(async () => { const bridge = desktopBridge()?.codex; if (!bridge?.selectAccount) throw new Error('Atualize o Desktop para gerir contas.'); await bridge.selectAccount(projectPath, id) }) }}>
      {accounts.profiles.map((profile) => {
        const used = Math.max(profile.rateLimits?.primary?.usedPercent || 0, profile.rateLimits?.secondary?.usedPercent || 0)
        return <option key={profile.id} value={profile.id}>{profile.label}{profile.account?.email ? ` · ${profile.account.email}` : ''}{used >= 100 ? ' · quota esgotada' : profile.rateLimits ? ` · ${used}% usado` : ''}</option>
      })}
    </select></label><button type="button" className={`${codexButton} mt-4`} disabled={busy || accounts.profiles.length >= 8} onClick={() => setAdding((value) => !value)}>Adicionar conta</button></div>
    {adding && <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run(async () => {
      const bridge = desktopBridge()?.codex
      if (!bridge?.createAccount) throw new Error('Atualize o Desktop para gerir contas.')
      await bridge.createAccount(projectPath, label); setAdding(false); setLabel(''); await bridge.login(projectPath)
    }) }}><input aria-label="Nome da conta Codex" maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} className="!min-w-0 !flex-1 !rounded-lg !border !border-whx-border-soft !bg-whx-muted !p-2 !text-xs" placeholder="Nome da conta"/><button type="submit" className={codexButton} disabled={busy || !label.trim()}>Criar e entrar</button></form>}
    <p className="mb-0 mt-2 leading-5 text-whx-faint">A conta selecionada será usada no próximo pedido ou na continuação manual.</p>
    {error && <p role="alert" className="mb-0 mt-2 text-whx-warning">{error}</p>}
  </section>
}
