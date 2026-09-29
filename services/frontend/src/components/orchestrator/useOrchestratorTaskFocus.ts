import { type Dispatch, type SetStateAction, useEffect, useRef } from 'react'
import type { OrchestratorOverview, OrchestratorTask } from '../../types'

type Section = 'overview' | 'tasks'

type Options = {
  active: boolean
  focusTaskId?: string
  focusTaskNonce?: number
  tasks: OrchestratorTask[]
  refresh: (quiet?: boolean) => Promise<OrchestratorOverview | undefined>
  setSection: Dispatch<SetStateAction<Section>>
  setPlanFilter: Dispatch<SetStateAction<string | undefined>>
  setSelectedTask: Dispatch<SetStateAction<OrchestratorTask | undefined>>
}

export function useOrchestratorTaskFocus({ active, focusTaskId, focusTaskNonce, tasks, refresh, setSection, setPlanFilter, setSelectedTask }: Options) {
  const handledRef = useRef('')
  const latestRef = useRef('')

  useEffect(() => {
    const taskId = focusTaskId?.trim()
    const focusKey = taskId && focusTaskNonce ? `${focusTaskNonce}:${taskId}` : ''
    if (!active || !taskId || !focusKey || handledRef.current === focusKey) return
    handledRef.current = focusKey
    latestRef.current = focusKey
    setPlanFilter(undefined)
    setSelectedTask(undefined)
    setSection('tasks')

    const localTask = tasks.find((task) => task.id === taskId)
    if (localTask) {
      setSelectedTask(localTask)
      return
    }
    void refresh(true).then((nextOverview) => {
      if (!nextOverview || latestRef.current !== focusKey) return
      const refreshedTask = nextOverview.tasks.find((task) => task.id === taskId)
      if (refreshedTask) setSelectedTask(refreshedTask)
    })
  }, [active, focusTaskId, focusTaskNonce, refresh, setPlanFilter, setSection, setSelectedTask, tasks])
}
