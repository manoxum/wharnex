import type { AutomationMode } from '../../../types'

export function isAutomaticAutomationMode(mode: AutomationMode | null | undefined): boolean {
  return mode === 'auto' || mode === 'auto_approve'
}

export function isAutoApproveAutomationMode(mode: AutomationMode | null | undefined): boolean {
  return mode === 'auto_approve'
}

export function automationModeLabel(mode: AutomationMode | null | undefined): string {
  if (mode === 'auto_approve') return 'Auto + Aprovar'
  if (mode === 'auto') return 'Auto'
  return 'Manual'
}
