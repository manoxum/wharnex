import type { ExecutionApproval, ExecutionMode } from '../types'
import { Icon } from './Icon'

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
  return <div className="execution-approval-details" aria-label="Detalhes da aprovação de execução">
    <div className="execution-approval-heading">
      <span className="plan-manual-mark"><Icon name="shield" size={13}/></span>
      <div>
        <span className="panel-kicker">Aprovação informada</span>
        <strong>{mode === 'full' && !requiresSudoPassword ? 'Full dispensa estes gates de comando' : 'Reveja o impacto antes de executar'}</strong>
        <small>O Wharnex executará apenas o argv validado abaixo. A descrição vem do contrato e da Policy local.</small>
      </div>
    </div>
    <div className="execution-approval-list">{items.map((item, index) => <div className="execution-approval-item" key={`${item.kind}:${index}`}>
      <div className="execution-approval-item-head"><strong>{item.kind}</strong>{item.bypass_in_full && <span>dispensável em Full</span>}{item.requires_sudo_password && <span>senha obrigatória</span>}</div>
      <p><b>Comando:</b> <code>{item.argv?.length ? JSON.stringify(item.argv) : 'não aplicável a este gate'}</code></p>
      <p><b>Motivo:</b> {item.rationale || 'A Policy local exige uma decisão explícita para esta fronteira.'}</p>
      <p><b>Efeito:</b> {item.effect}</p>
      <p><b>Impacto no host:</b> {item.host_impact}</p>
    </div>)}</div>
    {sudoNeedsHostDirect && <div className="sudo-credential-field"><span>sudo requer host direto</span><small>Mude explicitamente para Unprotected ou Full antes de fornecer a senha; Protected nunca recebe credenciais de sudo.</small></div>}
    {requiresSudoPassword && !sudoNeedsHostDirect && <label className="sudo-credential-field">
      <span>Senha sudo</span>
      <input type="password" value={sudoPassword} autoComplete="off" spellCheck={false} disabled={busy} onChange={(event) => onSudoPassword(event.target.value)} placeholder="Introduza apenas para esta execução"/>
      <small>A senha é enviada por um canal efémero para stdin do sudo e não é incluída no plano, eventos ou estado persistido.</small>
    </label>}
  </div>
}
