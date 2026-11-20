import { translate as uiText } from '../../../lib/workspace/localization'
import { useEffect, useState } from 'react'
import { loadUIPreferences, saveUIPreferences, subscribeUIPreferences, type UIPreferences } from '../../../lib/workspace/preferences/uiPreferences'
import { announceHeaderPopover, subscribeOtherHeaderPopover } from '../../../lib/desktop/bridge/headerPopover'
import { ControlPopover } from '../../presentation/workbench'
import { AppearanceChoices } from './appearance'

export function QuickSwitcher({ compact = true }: { compact?: boolean }) {
  const [preferences, setPreferences] = useState<UIPreferences>(() => loadUIPreferences())
  const [open, setOpen] = useState(false)
  function toggle(next: boolean) { if (next) announceHeaderPopover('appearance'); setOpen(next) }
  useEffect(() => subscribeUIPreferences(setPreferences), [])
  useEffect(() => subscribeOtherHeaderPopover('appearance', () => setOpen(false)), [])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'q') { event.preventDefault(); toggle(!open) }
    }
    window.addEventListener('keydown', shortcut, true)
    return () => window.removeEventListener('keydown', shortcut, true)
  }, [open])
  return <div className="inline-flex [-webkit-app-region:no-drag]">
    <ControlPopover label={uiText("Aparência rápida")} icon="monitor" triggerTitle={uiText("Aparência rápida · Ctrl/⌘ + Alt + Q")} triggerAdornment={compact ? undefined : <span>{uiText("Aparência")}</span>} alignment="end" density="compact" open={open} onOpenChange={toggle}>
      <AppearanceChoices preferences={preferences} onChange={(next) => setPreferences(saveUIPreferences({ ...preferences, ...next }))}/>
    </ControlPopover>
  </div>
}
