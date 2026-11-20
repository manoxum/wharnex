import { useSyncExternalStore } from 'react'
import type { OperationalTab } from './useOperationalTab'

const SELECT = 'wharnex:select-utility'
export type UtilityState = { tool: OperationalTab; visible: boolean; problems: number }
export function selectUtility(tool: OperationalTab) { window.dispatchEvent(new CustomEvent(SELECT, { detail: tool })) }
export function subscribeUtilitySelection(listener: (tool: OperationalTab) => void) {
  const receive = (event: Event) => {
    const tool = (event as CustomEvent).detail
    if (['terminal', 'problems', 'output'].includes(tool)) listener(tool)
  }
  window.addEventListener(SELECT, receive)
  return () => window.removeEventListener(SELECT, receive)
}
let snapshot: UtilityState = { tool: 'terminal', visible: false, problems: 0 }
const listeners = new Set<() => void>()
export function publishUtilityState(state: UtilityState) {
  snapshot = state
  listeners.forEach((listener) => listener())
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useUtilityState() { return useSyncExternalStore(subscribe, () => snapshot) }
