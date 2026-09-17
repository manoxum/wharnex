import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  UI_ACCENT_REGISTRY,
  UI_THEME_REGISTRY,
  loadUIPreferences,
  saveUIPreferences,
  subscribeUIPreferences,
  type ContentSchemePreference,
  type ThemePreference,
  type UIDensity,
  type UIPreferences,
} from '../lib/uiPreferences'
import { Icon } from './Icon'

const CONTENT_SCHEMES: Array<{ id: ContentSchemePreference; label: string }> = [
  { id: 'follow-ui', label: 'Seguir interface' },
  { id: 'original', label: 'Original' },
  { id: 'dark', label: 'Escuro' },
  { id: 'light', label: 'Claro' },
  { id: 'high-contrast', label: 'Alto contraste' },
]

export function QuickSwitcher({ compact = true }: { compact?: boolean }) {
  const [preferences, setPreferences] = useState<UIPreferences>(() => loadUIPreferences())
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeUIPreferences(setPreferences), [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'q') {
        event.preventDefault(); setOpen((current) => !current)
      } else if (event.key === 'Escape') setOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => { window.removeEventListener('keydown', onKeyDown); document.removeEventListener('pointerdown', onPointerDown) }
  }, [])

  function update(next: Partial<UIPreferences>) { setPreferences(saveUIPreferences({ ...preferences, ...next })) }

  return <div className="quick-switcher" ref={rootRef}>
    <button type="button" className={`quick-switcher-trigger${compact ? ' compact' : ''}`} aria-label="Aparência rápida" aria-expanded={open} title="Aparência rápida · Ctrl/⌘ + Alt + Q" onClick={() => setOpen((current) => !current)}><Icon name="monitor" size={14}/>{!compact && <span>Aparência</span>}</button>
    {open && <div className="quick-switcher-popover" role="dialog" aria-label="Aparência rápida" data-chatgpt-overlay-blocker="true">
      <header><div><strong>Aparência rápida</strong><small>Tema, cor e disposição do workbench</small></div><kbd>Ctrl/⌘ Alt Q</kbd></header>
      <SwitcherSection label="Tema da interface">{UI_THEME_REGISTRY.map((theme) => <ChoiceButton key={theme.id} active={preferences.theme === theme.id} label={`${theme.family} · ${theme.label}`} hint={theme.hint} onClick={() => update({ theme: theme.id as ThemePreference })}/>)}</SwitcherSection>
      <SwitcherSection label="Cor de destaque"><div className="quick-switcher-accents">{UI_ACCENT_REGISTRY.map((accent) => <button key={accent.id} type="button" className={`accent-choice accent-${accent.id}${preferences.accent === accent.id ? ' active' : ''}`} aria-label={`Destaque: ${accent.label}`} aria-pressed={preferences.accent === accent.id} onClick={() => update({ accent: accent.id })}><i/><span>{accent.label}</span></button>)}</div></SwitcherSection>
      <SwitcherSection label="Tool windows"><div className="quick-switcher-segments two"><button type="button" className={preferences.toolWindowMode === 'docked' ? 'active' : ''} onClick={() => update({ toolWindowMode: 'docked' })}>Acopladas</button><button type="button" className={preferences.toolWindowMode === 'floating' ? 'active' : ''} onClick={() => update({ toolWindowMode: 'floating' })}>Flutuantes</button></div></SwitcherSection>
      <SwitcherSection label="Barras de ferramentas"><div className="quick-switcher-segments two"><button type="button" className={preferences.toolRailPlacement === 'sides' ? 'active' : ''} onClick={() => update({ toolRailPlacement: 'sides' })}>Laterais</button><button type="button" className={preferences.toolRailPlacement === 'bottom' ? 'active' : ''} onClick={() => update({ toolRailPlacement: 'bottom' })}>Cantos inferiores</button></div></SwitcherSection>
      <SwitcherSection label="Esquema do conteúdo"><div className="quick-switcher-segments">{CONTENT_SCHEMES.map((scheme) => <button type="button" key={scheme.id} className={preferences.contentScheme === scheme.id ? 'active' : ''} aria-label={`Conteúdo: ${scheme.label}`} aria-pressed={preferences.contentScheme === scheme.id} onClick={() => update({ contentScheme: scheme.id })}>{scheme.label}</button>)}</div></SwitcherSection>
      <SwitcherSection label="Densidade"><div className="quick-switcher-segments two">{(['default', 'compact'] as UIDensity[]).map((density) => <button type="button" key={density} className={preferences.density === density ? 'active' : ''} aria-label={`Densidade: ${density === 'compact' ? 'Compacta' : 'Normal'}`} aria-pressed={preferences.density === density} onClick={() => update({ density })}>{density === 'compact' ? 'Compacta' : 'Normal'}</button>)}</div></SwitcherSection>
    </div>}
  </div>
}

function SwitcherSection({ label, children }: { label: string; children: ReactNode }) { return <section className="quick-switcher-section"><h3>{label}</h3>{children}</section> }
function ChoiceButton({ active, label, hint, onClick }: { active: boolean; label: string; hint: string; onClick: () => void }) { return <button type="button" className={`quick-switcher-choice${active ? ' active' : ''}`} aria-label={`Interface: ${label}`} aria-pressed={active} onClick={onClick}><span><strong>{label}</strong><small>{hint}</small></span>{active && <Icon name="check" size={12}/>}</button> }
