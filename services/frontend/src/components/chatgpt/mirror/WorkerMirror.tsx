import { useMemo } from 'react'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { MirrorSurface } from './MirrorSurface'

// A surfaced Worker's real view stays in the browser host; this mirrors it.
export function WorkerMirror({ agentId, label }: { agentId: string; label: string }) {
  const bridge = desktopBridge()?.agents
  const subscribe = useMemo(() => bridge?.onMirrorFrame
    ? (callback: (frame: DesktopMirrorFrame) => void) => bridge.onMirrorFrame((frame) => { if (frame.agentId === agentId) callback(frame) })
    : undefined, [bridge, agentId])
  const send = useMemo(() => bridge?.mirrorInput
    ? (input: DesktopMirrorInput) => bridge.mirrorInput(agentId, input)
    : undefined, [bridge, agentId])
  if (!subscribe || !send) return null
  return <MirrorSurface subscribe={subscribe} send={send} label={label} />
}
