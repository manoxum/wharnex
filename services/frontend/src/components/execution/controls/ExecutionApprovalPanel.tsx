import type { ExecutionApproval, ExecutionMode } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'

type Props = {
  items: ExecutionApproval[]
  mode: ExecutionMode
  busy: boolean
  sudoPassword: string
  onSudoPassword: (value: string) => void
}

export function ExecutionApprovalPanel({ items, mode, busy, sudoPassword, onSudoPassword }: Props) {
  if (!items.length) return null
  const requiresSudoPassword = items.some((item) => item.requires_sudo_password)
  const sudoNeedsHostDirect = requiresSudoPassword && mode === 'protected'
  return <div className="grid min-w-0 gap-2.5 rounded-[11px] border border-[color-mix(in_srgb,var(--theme-accent)_28%,var(--theme-border-soft))] bg-[color-mix(in_srgb,var(--theme-accent-soft)_48%,var(--theme-surface))] p-3" aria-label="Detalhes da aprovação de execução">
    <div className="flex items-start gap-2.5 [&>div]:grid [&>div]:min-w-0 [&>div]:gap-0.5 [&_strong]:text-[calc(10.5px*var(--ui-font-scale))] [&_strong]:text-[var(--theme-text)] [&_small]:text-[calc(8.5px*var(--ui-font-scale))] [&_small]:leading-[1.45] [&_small]:text-[var(--theme-text-muted)]">
      <span className="plan-manual-mark"><Icon name="shield" size={13}/></span>
      <div>
        <span className="panel-kicker">Aprovação informada</span>
        <strong>{mode === 'full' && !requiresSudoPassword ? 'Full dispensa estes gates de comando' : 'Reveja o impacto antes de executar'}</strong>
        <small>O Wharnex executará apenas o argv validado abaixo. A descrição vem do contrato e da Policy local.</small>
      </div>
    </div>
    <div className="grid gap-2">{items.map((item, index) => <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 rounded-[9px] border border-[var(--theme-border-soft)] bg-[var(--theme-elevated)] p-2.5 [&_p]:m-0 [&_p]:text-[calc(8.5px*var(--ui-font-scale))] [&_p]:leading-[1.45] [&_p]:text-[var(--theme-text-muted)] [&_b]:text-[var(--theme-text-soft)] [&_code]:block [&_code]:max-w-full [&_code]:overflow-x-auto [&_code]:whitespace-pre [&_code]:rounded-[7px] [&_code]:bg-[var(--theme-subtle)] [&_code]:px-2 [&_code]:py-[7px] [&_code]:text-[calc(8.5px*var(--ui-font-scale))] [&_code]:text-[var(--theme-text)]" key={`${item.kind}:${index}`}>
      <div className="flex flex-wrap items-center gap-1.5 [&_strong]:text-[calc(9.5px*var(--ui-font-scale))] [&_strong]:uppercase [&_strong]:tracking-[.08em] [&_strong]:text-[var(--theme-text)] [&_span]:rounded-full [&_span]:bg-[var(--theme-subtle)] [&_span]:px-1.5 [&_span]:py-0.5 [&_span]:text-[calc(7.5px*var(--ui-font-scale))] [&_span]:text-[var(--theme-text-muted)]"><strong>{item.kind}</strong>{item.bypass_in_full && <span>dispensável em Full</span>}{item.requires_sudo_password && <span>senha obrigatória</span>}</div>
      <p><b>Comando:</b> <code>{item.argv?.length ? JSON.stringify(item.argv) : 'não aplicável a este gate'}</code></p>
      <p><b>Motivo:</b> {item.rationale || 'A Policy local exige uma decisão explícita para esta fronteira.'}</p>
      <p><b>Efeito:</b> {item.effect}</p>
      <p><b>Impacto no host:</b> {item.host_impact}</p>
    </div>)}</div>
    {sudoNeedsHostDirect && <div className="grid gap-[5px] [&>span]:text-[calc(9px*var(--ui-font-scale))] [&>span]:font-semibold [&>span]:text-[var(--theme-text)] [&_input]:min-h-[34px] [&_input]:rounded-lg [&_input]:border [&_input]:border-[var(--theme-border)] [&_input]:bg-[var(--theme-elevated)] [&_input]:px-2.5 [&_input]:text-[var(--theme-text)] [&_small]:text-[calc(8px*var(--ui-font-scale))] [&_small]:leading-[1.45] [&_small]:text-[var(--theme-text-muted)]"><span>sudo requer host direto</span><small>Mude explicitamente para Unprotected ou Full antes de fornecer a senha; Protected nunca recebe credenciais de sudo.</small></div>}
    {requiresSudoPassword && !sudoNeedsHostDirect && <label className="grid gap-[5px] [&>span]:text-[calc(9px*var(--ui-font-scale))] [&>span]:font-semibold [&>span]:text-[var(--theme-text)] [&_input]:min-h-[34px] [&_input]:rounded-lg [&_input]:border [&_input]:border-[var(--theme-border)] [&_input]:bg-[var(--theme-elevated)] [&_input]:px-2.5 [&_input]:text-[var(--theme-text)] [&_small]:text-[calc(8px*var(--ui-font-scale))] [&_small]:leading-[1.45] [&_small]:text-[var(--theme-text-muted)]">
      <span>Senha sudo</span>
      <input type="password" value={sudoPassword} autoComplete="off" spellCheck={false} disabled={busy} onChange={(event) => onSudoPassword(event.target.value)} placeholder="Introduza apenas para esta execução"/>
      <small>A senha é enviada por um canal efémero para stdin do sudo e não é incluída no plano, eventos ou estado persistido.</small>
    </label>}
  </div>
}
