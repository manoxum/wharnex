import { createContext, createElement, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { taskBrowserAgentId } from '../../../lib/chat/transport/chatAgentTaskNav'
import type { ChatAgentTask, OrchestratorOverview } from '../../../types'

type PlanningRequest = OrchestratorOverview['planning_requests'][number]

export type OrchestratorWorkerFollow = {
  taskId: string
  agentId: string
}

export type OrchestratorWorkerFollowRegistry = {
  follows: OrchestratorWorkerFollow[]
  isFollowing: (taskId: string, agentId: string) => boolean
  toggle: (taskId: string, agentId: string) => void
  stop: (taskId: string, agentId: string) => void
}

function matchesFollow(follow: OrchestratorWorkerFollow, requests: PlanningRequest[], tasks: ChatAgentTask[]) {
  const request = requests.find((item) => item.task_id === follow.taskId)
  if (!request || !['LEASED', 'RUNNING'].includes(request.status)) return false
  const task = tasks.find((item) => item.task_id === follow.taskId)
  return taskBrowserAgentId(task) === follow.agentId
}

export function useOrchestratorWorkerFollows(requests: PlanningRequest[], tasks: ChatAgentTask[]): OrchestratorWorkerFollowRegistry {
  const [follows, setFollows] = useState<OrchestratorWorkerFollow[]>([])

  useEffect(() => {
    setFollows((current) => {
      const next = current.filter((follow) => matchesFollow(follow, requests, tasks))
      return next.length === current.length ? current : next
    })
  }, [requests, tasks])

  const isFollowing = useCallback((taskId: string, agentId: string) => (
    follows.some((follow) => follow.taskId === taskId && follow.agentId === agentId)
  ), [follows])

  const toggle = useCallback((taskId: string, agentId: string) => {
    setFollows((current) => {
      const index = current.findIndex((follow) => follow.taskId === taskId && follow.agentId === agentId)
      if (index >= 0) return current.filter((_, currentIndex) => currentIndex !== index)
      const follow = { taskId, agentId }
      return matchesFollow(follow, requests, tasks) ? [...current, follow] : current
    })
  }, [requests, tasks])

  const stop = useCallback((taskId: string, agentId: string) => {
    setFollows((current) => current.filter((follow) => follow.taskId !== taskId || follow.agentId !== agentId))
  }, [])

  return { follows, isFollowing, toggle, stop }
}

const fallbackRegistry: OrchestratorWorkerFollowRegistry = {
  follows: [],
  isFollowing: () => false,
  toggle: () => undefined,
  stop: () => undefined,
}

const OrchestratorWorkerFollowContext = createContext<OrchestratorWorkerFollowRegistry | undefined>(undefined)

export function OrchestratorWorkerFollowProvider({ registry, children }: { registry: OrchestratorWorkerFollowRegistry; children: ReactNode }) {
  return createElement(OrchestratorWorkerFollowContext.Provider, { value: registry }, children)
}

export function useOrchestratorWorkerFollowRegistry() {
  return useContext(OrchestratorWorkerFollowContext) || fallbackRegistry
}
