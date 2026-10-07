import { useCallback, useEffect, useState } from 'react'
import { automationHoldsApi, holdInForce, holdUntilLabel, taskHold, type AutomationHolds, type TaskPolicy } from '../../../../lib/agent/automationHolds'
import { Icon } from '../../../presentation/chrome/Icon'
import { uiSecondaryButtonClass } from '../uiTestingStyles'

type Props = { onError: (message: string) => void; api?: typeof automationHoldsApi }

const UI_TEST_TYPES = ['UI_TEST_DISCOVER', 'UI_TEST_RUN']

// Operator controls for the durable holds that govern UI Lab: suspending every
// UI test through the per-type task holds (the claim stops; nothing in the
// queue is lost or charged) and the account file-upload limit the Desktop
// detected, which a switched ChatGPT account makes obsolete.
export function UIAutomationHolds({ onError, api = automationHoldsApi }: Props) {
  const [holds, setHolds] = useState<AutomationHolds>()
  const [policies, setPolicies] = useState<TaskPolicy[]>([])
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { const state = await api.list(); setHolds(state.holds); setPolicies(state.task_policies || []) } catch (error) { onError(messageOf(error)) }
  }, [api, onError])
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 5000); return () => window.clearInterval(timer) }, [load])
  async function act(run: () => Promise<unknown>) {
    setBusy(true)
    try { await run(); await load() } catch (error) { onError(messageOf(error)) } finally { setBusy(false) }
  }
  if (!holds) return null
  const uiPolicies = policies.filter((policy) => UI_TEST_TYPES.includes(policy.type))
  const suspended = uiPolicies.length > 0 && uiPolicies.some((policy) => policy.state === 'suspended')
  const allSuspended = uiPolicies.length === UI_TEST_TYPES.length && uiPolicies.every((policy) => policy.state === 'suspended')
  const cooling = uiPolicies.some((policy) => policy.state === 'cooldown')
  const uploadLimited = holdInForce(holds.chatgpt_upload)
  return <div className="space-y-2 border-b border-whx-border p-3">
    <div role="status" className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-base leading-5 ${suspended ? 'border-whx-warning/30 bg-whx-warning/10 text-whx-warning' : 'border-whx-border bg-whx-surface text-whx-faint'}`}>
      <Icon name={suspended ? 'pause' : 'play'} size={13}/>
      <span className="min-w-0 flex-1 basis-[calc(100%-32px)] @min-[520px]:basis-auto">{statusLabel(uiPolicies, suspended, allSuspended, cooling)}</span>
      <button className={uiSecondaryButtonClass} disabled={busy}
        onClick={() => void act(() => Promise.all(UI_TEST_TYPES.map((type) => api.set(taskHold(type), suspended ? { active: false } : { active: true, reason: 'Suspensão manual no UI Lab', source: 'ui-lab' }))))}>
        <Icon name={suspended ? 'play' : 'pause'} size={13}/> {suspended ? 'Retomar testes UI' : 'Suspender testes UI'}
      </button>
    </div>
    {uploadLimited && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-whx-warning/30 bg-whx-warning/10 px-3 py-2 text-base leading-5 text-whx-warning">
      <Icon name="alert" size={13}/>
      <span className="min-w-0 flex-1 basis-[calc(100%-32px)] @min-[520px]:basis-auto">Limite de upload da conta ChatGPT atingido. Os envios com ficheiros aguardam sem gastar tentativas{holdUntilLabel(holds.chatgpt_upload) ? ` até ${holdUntilLabel(holds.chatgpt_upload)}` : ''}; depois um único envio confirma se o limite passou.</span>
      <button className={uiSecondaryButtonClass} disabled={busy}
        title="Use depois de mudar de conta ChatGPT"
        onClick={() => void act(() => api.set('chatgpt_upload', { active: false }))}>Libertar limite</button>
    </div>}
  </div>
}

function messageOf(value: unknown) { return value instanceof Error ? value.message : String(value) }

function statusLabel(policies: TaskPolicy[], suspended: boolean, allSuspended: boolean, cooling: boolean) {
  if (allSuspended) return 'Testes UI suspensos. A fila fica preservada em todos os projetos.'
  if (suspended) return policies.find((policy) => policy.type === 'UI_TEST_RUN')?.state === 'suspended'
    ? 'Execução suspensa. Retome testes UI para libertar a fila.'
    : 'Descoberta suspensa. Retome testes UI para atualizar o catálogo.'
  if (cooling) return 'Testes UI em espera pelo serviço ChatGPT. A fila retoma após o período de espera.'
  return 'Testes UI ativos · um teste de cada vez nos Workers.'
}
