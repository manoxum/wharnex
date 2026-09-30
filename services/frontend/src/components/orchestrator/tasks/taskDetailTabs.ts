export type TaskDetailTab = 'overview' | 'bundle' | 'plan' | 'execution' | 'engine'

export const TASK_DETAIL_TABS: Array<{ id: TaskDetailTab; label: string; icon: 'info' | 'package' | 'plan' | 'terminal' | 'monitor' }> = [
  { id: 'overview', label: 'Overview', icon: 'info' },
  { id: 'bundle', label: 'Bundles', icon: 'package' },
  { id: 'plan', label: 'Plano', icon: 'plan' },
  { id: 'execution', label: 'Execution', icon: 'terminal' },
  { id: 'engine', label: 'Engine', icon: 'monitor' },
]
