import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'

const AGENT_FOLLOW_EVENT = 'wharnex:agent-follow'

export function useAgentFollowEvent(bridge: ReturnType<typeof desktopBridge>, setFollowedAgentId: Dispatch<SetStateAction<string>>) {
  useEffect(() => {
    const agents = bridge?.agents
    if (!agents) return
    let active = true
    const onFollow = (event: Event) => {
      const agentId = String((event as CustomEvent<{ agentId?: string }>).detail?.agentId || '').trim()
      if (!agentId) return
      void agents.state().then((state) => {
        if (active && state.agents.some((agent) => agent.id === agentId && agent.role === 'worker' && agent.browser.available)) setFollowedAgentId(agentId)
      }).catch(() => undefined)
    }
    window.addEventListener(AGENT_FOLLOW_EVENT, onFollow)
    return () => { active = false; window.removeEventListener(AGENT_FOLLOW_EVENT, onFollow) }
  }, [bridge, setFollowedAgentId])
}
