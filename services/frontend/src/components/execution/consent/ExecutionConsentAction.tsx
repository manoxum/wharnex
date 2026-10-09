import { useRef, useState } from 'react'
import type { Session } from '../../../types'
import { sessionCanApproveDebug, sessionCanExecutePlan } from '../../../lib/execution/recovery/executionRecovery'
import { Icon } from '../../presentation/chrome/Icon'

type Props = {
  session: Session
  surface?: 'chat' | 'plan'
  canExecute?: boolean
  busy: boolean
  sudoPassword: string
  onClearPassword: () => void
  onExecute?: (approved: boolean, sudoPassword?: string) => Promise<void>
  onApproveDebug?: () => Promise<void>
}

export function ExecutionConsentAction({ session, surface = 'plan', canExecute = true, busy, sudoPassword, onClearPassword, onExecute, onApproveDebug }: Props) {
  const [pending, setPending] = useState(false)
  const locked = useRef(false)
  const [error, setError] = useState('')
  const debug = sessionCanApproveDebug(session)
  const ordinary = canExecute && sessionCanExecutePlan(session)
  if (!debug && !ordinary) return null
  const sudo = !debug && Boolean(session.policy?.approval_items?.some((item) => item.requires_sudo_password))
  const blockedSudo = sudo && session.execution_mode === 'protected'
  const label = debug
    ? `Autorizar ${session.plan!.debug!.protocol === 'harness.interactive/v2' ? 'Interactive v2' : 'debug'} · ${session.plan!.debug!.target} · ${session.plan!.debug!.access || 'observe'}`
    : blockedSudo ? 'sudo requer Full/Unprotected' : sudo ? 'Autorizar sudo e executar'
    : session.execution_mode === 'full' ? 'Executar no host · Full'
    : session.execution_mode === 'unprotected' ? 'Confirmar execução no host' : 'Aceitar e executar'
  const submit = async () => {
    if (busy || locked.current || blockedSudo || (sudo && !sudoPassword)) return
    locked.current = true; setPending(true); setError('')
    try {
      if (debug) await onApproveDebug?.()
      else await onExecute?.(true, sudo ? sudoPassword : '')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (sudo) onClearPassword(); locked.current = false; setPending(false) }
  }
  return <>
    <button type="button" className="!inline-flex !items-center !gap-2 !rounded-lg !border !border-[var(--theme-accent)] !bg-[var(--theme-accent)] !px-3 !py-2 !text-sm !font-semibold !text-[var(--theme-bg)] disabled:!cursor-not-allowed disabled:!opacity-50" aria-label={surface === 'chat' ? `${label} no chat` : undefined} disabled={busy || pending || blockedSudo || (sudo && !sudoPassword)} onClick={() => void submit()}>
      <Icon name={debug ? 'terminal' : 'check'} size={14}/>{pending ? 'A autorizar…' : label}
    </button>
    {error && <p className="!text-sm !text-[var(--theme-danger)]" role="alert">{error}</p>}
  </>
}
