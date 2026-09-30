import type { EffortLevel, OrchestratorTask, Session } from '../../../types'

// The composer's attempt budgets, without Loop: a task must end in FAILED
// once its budget is spent. The backend enforces the same bound.
export const TASK_EFFORT_LEVELS: { value: EffortLevel; label: string }[] = [
  { value: 'low', label: 'Low · 3' },
  { value: 'medium', label: 'Medium · 8' },
  { value: 'high', label: 'High · 15' },
  { value: 'extra_high', label: 'Extra High · 20' },
  { value: 'max', label: 'Max · 30' },
  { value: 'ultra', label: 'Ultra · 50' },
]

export function taskEffortLevel(task: OrchestratorTask, session: Session): EffortLevel {
  const own = TASK_EFFORT_LEVELS.find((level) => level.value === task.effort_level)
  if (own) return own.value
  if (session.effort_level === 'loop') return 'ultra'
  return TASK_EFFORT_LEVELS.find((level) => level.value === session.effort_level)?.value || 'medium'
}
