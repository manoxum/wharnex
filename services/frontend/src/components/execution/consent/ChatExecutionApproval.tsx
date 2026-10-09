import { useEffect, useState } from 'react'
import type { Session } from '../../../types'
import { sessionCanApproveDebug, sessionCanExecutePlan, sessionNeedsExecutionConsent } from '../../../lib/execution/recovery/executionRecovery'
import { MarkdownContent } from '../../presentation/content/MarkdownContent'
import { ExecutionApprovalPanel } from '../controls/ExecutionApprovalPanel'
import { ExecutionConsentAction } from './ExecutionConsentAction'

type Props = {
  session: Session
  busy: boolean
  onExecute: (approved: boolean, sudoPassword?: string) => Promise<void>
  onApproveDebug?: () => Promise<void>
  onRejectExecutionPlan?: () => Promise<void>
}

export function ChatExecutionApproval({ session, busy, onExecute, onApproveDebug, onRejectExecutionPlan }: Props) {
  const [sudoPassword, setSudoPassword] = useState('')
  useEffect(() => { setSudoPassword('') }, [session.id, session.plan?.plan_id])
  const debug = sessionCanApproveDebug(session) && Boolean(onApproveDebug)
  if (!session.plan || (!debug && (!sessionCanExecutePlan(session) || !sessionNeedsExecutionConsent(session)))) return null
  const plan = session.plan
  const host = plan.debug?.target === 'host' || session.execution_mode !== 'protected'
  const commands = [...(plan.operations || []).filter((op) => op.type === 'command').map((op) => op.command!), ...(plan.verification || [])]
  return <section aria-label="Aprovação de execução no chat" className="!m-3 !space-y-3 !rounded-xl !border !border-[var(--theme-border)] !bg-[var(--theme-elevated)] !p-4 !text-[var(--theme-text)]">
    <header><strong className="!block !text-sm">{debug ? 'Autorizar extração de informações' : 'Aprovar execução'}</strong><p className="!mt-1 !text-sm">{plan.summary}</p><code className="!break-all !text-xs">{plan.plan_id}</code></header>
    <p className="!text-xs !text-[var(--theme-text-muted)]">{debug ? `Este plano recolhe evidência no ${host ? 'host' : 'sandbox'}; acesso ${plan.debug?.access || 'observe'}.` : host ? 'Execução direta no host, mediante esta confirmação.' : 'Esta aprovação autoriza execução na cópia Protected e integração no host após verificação.'}</p>
    {plan.debug && <div className="!space-y-1 !text-xs"><p><b>Motivo:</b> {plan.debug.rationale}</p>{plan.debug.capabilities?.length ? <p><b>Capacidades:</b> {plan.debug.capabilities.join(', ')}</p> : null}{plan.debug.scope && <pre className="!max-h-40 !overflow-auto !whitespace-pre-wrap !break-all">{JSON.stringify(plan.debug.scope, null, 2)}</pre>}</div>}
    <div className="!space-y-2" aria-label="Operações a autorizar">
      {commands.map((command, index) => <div key={index} className="!rounded !border !border-[var(--theme-border)] !p-2 !text-xs"><code className="!block !whitespace-pre-wrap !break-all">{JSON.stringify(command.argv)}</code><p>{command.cwd || '.'} · rede {command.network ? 'solicitada' : 'desativada'} · {command.timeout_seconds}s</p>{command.rationale && <p>{command.rationale}</p>}</div>)}
      {(plan.operations || []).filter((op) => op.type !== 'command').map((op, index) => <pre key={`operation:${index}`} className="!max-h-48 !overflow-auto !whitespace-pre-wrap !break-all !text-xs">{JSON.stringify(op, null, 2)}</pre>)}
    </div>
    {plan.system_tools?.length ? <pre className="!max-h-40 !overflow-auto !whitespace-pre-wrap !break-all !text-xs">{JSON.stringify(plan.system_tools, null, 2)}</pre> : null}
    {plan.document && <details><summary className="!cursor-pointer !text-sm">Contrato completo</summary><MarkdownContent markdown={plan.document}/></details>}
    <ExecutionApprovalPanel items={session.policy?.approval_items || []} mode={session.execution_mode} busy={busy} sudoPassword={sudoPassword} onSudoPassword={setSudoPassword}/>
    <div className="!flex !flex-wrap !items-center !gap-2">
      <ExecutionConsentAction surface="chat" session={session} busy={busy} sudoPassword={sudoPassword} onClearPassword={() => setSudoPassword('')} onExecute={onExecute} onApproveDebug={onApproveDebug}/>
      {!debug && onRejectExecutionPlan && <button type="button" className="!rounded-lg !border !border-[var(--theme-border)] !px-3 !py-2 !text-sm" disabled={busy} onClick={() => void onRejectExecutionPlan()}>Rejeitar</button>}
    </div>
  </section>
}
