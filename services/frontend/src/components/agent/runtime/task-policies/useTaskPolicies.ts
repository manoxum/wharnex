import { useCallback, useEffect, useState } from 'react'
import { automationHoldsApi, taskHold, type TaskCooldown, type TaskPolicy } from '../../../../lib/agent/automationHolds'

export type TaskPolicyDeps = {
  api?: typeof automationHoldsApi
  // Releasing the Worker rate-limit cooldown goes through the Desktop, which
  // owns the resume confirmation probe.
  releaseRateLimit?: () => Promise<unknown>
  // Without it the surface confirms inline (the browser monitor, where a
  // modal would open underneath the native browser view).
  confirm?: (cooldown: TaskCooldown['kind']) => Promise<boolean> | boolean
  onError?: (message: string) => void
  pollMs?: number
}

const MANUAL = { reason: 'Suspensão manual nas Políticas', source: 'policies' }

export function useTaskPolicies({ api = automationHoldsApi, releaseRateLimit, confirm, onError, pollMs = 5000 }: TaskPolicyDeps) {
  const [policies, setPolicies] = useState<TaskPolicy[]>()
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<string>()
  const report = useCallback((error: unknown) => onError?.(error instanceof Error ? error.message : String(error)), [onError])
  const load = useCallback(async () => {
    try { setPolicies((await api.list()).task_policies) } catch (error) { report(error) }
  }, [api, report])
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), pollMs); return () => window.clearInterval(timer) }, [load, pollMs])

  async function act(run: () => Promise<unknown>) {
    setBusy(true)
    try { await run(); await load() } catch (error) { report(error) } finally { setBusy(false) }
  }

  // Without `until` the suspension waits for an explicit resume.
  const suspend = (types: string[], until?: string) => act(() => Promise.all(types.map((type) => api.set(taskHold(type), { active: true, ...MANUAL, ...(until ? { until } : {}) }))))
  const resumeHolds = (types: string[]) => act(() => Promise.all(types.map((type) => api.set(taskHold(type), { active: false }))))

  // A cooldown is account-wide: releasing it frees every type it reaches, so
  // the operator confirms first.
  async function releaseCooldown(kind: TaskCooldown['kind']) {
    if (confirm && !await confirm(kind)) return
    if (kind === 'upload_limit') await act(() => api.set('chatgpt_upload', { active: false }))
    else if (releaseRateLimit) await act(releaseRateLimit)
    else report(new Error('A libertação do rate limit só está disponível na Desktop.'))
  }

  // Retomar does what the state needs: a suspension is released first; a
  // type only in cooldown releases that cooldown.
  async function resume(policy: TaskPolicy, { confirmed = false } = {}) {
    if (policy.state === 'suspended') return resumeHolds([policy.type])
    if (!confirm && !confirmed) { setPending(policy.type); return }
    setPending(undefined)
    for (const cooldown of policy.cooldowns) await releaseCooldown(cooldown.kind)
  }

  return { policies, busy, pending, cancelPending: () => setPending(undefined), suspend, resume, resumeHolds }
}
