import { useState } from 'react'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'

export type WorkerTaskTypeOption = readonly [type: string, label: string]
export type WorkerTaskTypeGroup = {
  id: string
  label: string
  description: string
  tasks: readonly WorkerTaskTypeOption[]
}

export const workerTaskTypeGroups: readonly WorkerTaskTypeGroup[] = [
  {
    id: 'auxiliary',
    label: 'Auxiliar',
    description: 'Manutenção de chats, bundles e títulos.',
    tasks: [
      ['ORGANIZE_CHAT', 'Organizar chat'],
      ['RENAME_CHAT', 'Renomear chat'],
      ['ARCHIVE_CHAT', 'Arquivar chat'],
      ['DELETE_CHAT', 'Eliminar chat'],
      ['DELETE_TEMP_CHAT', 'Eliminar chat temporário'],
      ['DELETE_BUNDLE', 'Eliminar bundle'],
      ['TITLE_DISCOVER', 'Descobrir título'],
      ['TITLE_GENERATE_TEMP', 'Gerar título temporário'],
      ['TITLE_AWAIT', 'Aguardar título'],
    ],
  },
  {
    id: 'functional',
    label: 'Funcional',
    description: 'Trabalho funcional delegado ao pool de Workers.',
    tasks: [
      ['TODO_CLASSIFY', 'Classificar TODO'],
    ],
  },
]

export function short(value?: string, fallback = '—') {
  const text = String(value || '').trim()
  return text || fallback
}

export function timeLabel(value?: string) {
  const text = String(value || '').trim()
  if (!text) return '—'
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString()
}

export type AgentRuntimePolicyChanges = { auto_scale?: boolean; auto_scale_max_supervisors?: number; auto_scale_max_workers?: number; keep_flowing_global?: boolean; rate_limit_cooldown_minutes?: number }

// The runtime policy operations - provider protection, pool capacity and
// Worker automation - shared by every surface that presents them. Releasing a
// rate-limit cooldown early is confirmed by the surface, in its own way.
export function useAgentRuntimePolicyActions({ runtime, onRuntime, onError, confirmRelease }: {
  runtime: DesktopAgentRuntimeState
  onRuntime: (runtime: DesktopAgentRuntimeState) => void
  onError?: (message: string) => void
  confirmRelease: () => Promise<boolean> | boolean
}) {
  const bridge = desktopBridge()?.agents
  const setRuntime = onRuntime
  const [busy, setBusy] = useState(false)
  const [workerPauseMode, setWorkerPauseMode] = useState<'timed' | 'manual'>('timed')
  const [workerPauseMinutes, setWorkerPauseMinutes] = useState('60')
  const [workerPauseScope, setWorkerPauseScope] = useState<'all' | 'types'>('all')
  const [workerPauseTaskTypes, setWorkerPauseTaskTypes] = useState<string[]>([])

  const scaleSupervisors = async (delta: number) => {
    if (!bridge || !runtime) return
    const configured = runtime.configured_supervisors || runtime.desired_supervisors
    const next = Math.max(runtime.limits.min_supervisors, Math.min(runtime.limits.max_supervisors, configured + delta))
    if (next === configured) return
    setBusy(true)
    try { setRuntime(await bridge.setSupervisorCount(next)) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível escalar os supervisores') } finally { setBusy(false) }
  }

  const scaleWorkers = async (delta: number) => {
    if (!bridge || !runtime) return
    const configured = runtime.configured_workers || runtime.desired_workers
    const next = Math.max(runtime.limits.min_workers, Math.min(runtime.limits.max_workers, configured + delta))
    if (next === configured) return
    setBusy(true)
    try { setRuntime(await bridge.setWorkerCount(next)) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível escalar os workers') } finally { setBusy(false) }
  }

  const updatePolicies = async (changes: AgentRuntimePolicyChanges) => {
    if (!bridge) return
    setBusy(true)
    try { setRuntime(await bridge.setPolicies(changes)) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível atualizar as políticas') } finally { setBusy(false) }
  }

  const scaleAutoScaleCeiling = async (delta: number) => {
    if (!runtime) return
    const ceiling = runtime.policies.auto_scale_max_workers || runtime.limits.max_workers
    const next = Math.max(runtime.limits.min_workers, Math.min(runtime.limits.max_workers, ceiling + delta))
    if (next === ceiling) return
    await updatePolicies({ auto_scale_max_workers: next })
  }

  const scaleAutoScaleSupervisorCeiling = async (delta: number) => {
    if (!runtime) return
    const ceiling = runtime.policies.auto_scale_max_supervisors || runtime.limits.max_supervisors
    const next = Math.max(runtime.limits.min_supervisors, Math.min(runtime.limits.max_supervisors, ceiling + delta))
    if (next === ceiling) return
    await updatePolicies({ auto_scale_max_supervisors: next })
  }


  const suspendWorkers = async () => {
    if (!bridge) return
    if (workerPauseScope === 'types' && workerPauseTaskTypes.length === 0) {
      onError?.('Selecione pelo menos um tipo de tarefa para suspender.')
      return
    }
    let pausedUntil: string | undefined
    if (workerPauseMode === 'timed') {
      const minutes = Number(workerPauseMinutes)
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10_080) {
        onError?.('Defina uma duração dos Workers entre 1 minuto e 7 dias.')
        return
      }
      pausedUntil = new Date(Date.now() + Math.floor(minutes) * 60_000).toISOString()
    }
    setBusy(true)
    try { setRuntime(await bridge.pauseWorkers(pausedUntil, workerPauseScope === 'types' ? workerPauseTaskTypes : [])) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível suspender os Workers') } finally { setBusy(false) }
  }

  // Releasing early skips the cooldown that protects the account, so it is an
  // explicit, confirmed operator decision.
  const releaseRateLimit = async () => {
    if (!bridge) return
    if (!await confirmRelease()) return
    setBusy(true)
    try { setRuntime(await bridge.resumeProvider()) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível libertar a suspensão por rate limit') } finally { setBusy(false) }
  }

  const resumeWorkers = async () => {
    if (!bridge) return
    setBusy(true)
    try { setRuntime(await bridge.resumeWorkers()) } catch (error) { onError?.(error instanceof Error ? error.message : 'Não foi possível retomar os Workers') } finally { setBusy(false) }
  }

  return {
    busy, workerPauseMode, setWorkerPauseMode, workerPauseMinutes, setWorkerPauseMinutes,
    workerPauseScope, setWorkerPauseScope, workerPauseTaskTypes, setWorkerPauseTaskTypes,
    scaleSupervisors, scaleWorkers, updatePolicies, scaleAutoScaleCeiling, scaleAutoScaleSupervisorCeiling,
    suspendWorkers, releaseRateLimit, resumeWorkers,
  }
}
