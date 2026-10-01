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
} from '../../../lib/workspace/preferences/uiPreferences'
import { announceHeaderPopover, subscribeOtherHeaderPopover } from '../../../lib/desktop/bridge/headerPopover'
import { Icon } from '../../presentation/chrome/Icon'

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
  const activeTheme = UI_THEME_REGISTRY.find((theme) => theme.id === preferences.theme) || UI_THEME_REGISTRY[0]
  const activeAccent = UI_ACCENT_REGISTRY.find((accent) => accent.id === preferences.accent) || UI_ACCENT_REGISTRY[0]

  useEffect(() => subscribeUIPreferences(setPreferences), [])
  useEffect(() => subscribeOtherHeaderPopover('appearance', () => setOpen(false)), [])
  useEffect(() => {
    const closePopup = () => setOpen(false)
    const insideSwitcher = (target: EventTarget | null) => target instanceof Node && Boolean(rootRef.current?.contains(target))
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'q') {
        event.preventDefault()
        if (!open) announceHeaderPopover('appearance')
        setOpen((current) => !current)
      } else if (event.key === 'Escape') closePopup()
    }
    const onPointerDown = (event: PointerEvent) => { if (!insideSwitcher(event.target)) closePopup() }
    const onFocusIn = (event: FocusEvent) => { if (!insideSwitcher(event.target)) closePopup() }
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    window.addEventListener('blur', closePopup)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      window.removeEventListener('blur', closePopup)
    }
  }, [open])

  function update(next: Partial<UIPreferences>) { setPreferences(saveUIPreferences({ ...preferences, ...next })) }

  return <div className="quick-switcher" ref={rootRef}>
    <button type="button" className={`quick-switcher-trigger${compact ? ' compact' : ''}`} aria-label="Aparência rápida" aria-expanded={open} title="Aparência rápida · Ctrl/⌘ + Alt + Q" onClick={() => { if (!open) announceHeaderPopover('appearance'); setOpen((current) => !current) }}><Icon name="monitor" size={14}/>{!compact && <span>Aparência</span>}</button>
    {open && <div className="quick-switcher-popover" role="dialog" aria-label="Aparência rápida">
      <header>
        <div><span className="quick-switcher-eyebrow">Workbench</span><strong>Aparência</strong><small>{activeTheme.family} · {activeTheme.label}</small></div>
        <kbd>Ctrl/⌘ Alt Q</kbd>
      </header>

      <div className="quick-switcher-primary">
        <label className="quick-switcher-control">
          <span><strong>Tema</strong><small>Preset visual da interface</small></span>
          <span className="quick-switcher-select-shell"><select aria-label="Tema da interface" value={preferences.theme} onChange={(event) => update({ theme: event.target.value as ThemePreference })}>{UI_THEME_REGISTRY.map((theme) => <option key={theme.id} value={theme.id}>{theme.family} · {theme.label}</option>)}</select><Icon name="chevron" size={11}/></span>
        </label>

        <div className="quick-switcher-accent-row">
          <span><strong>Destaque</strong><small>{activeAccent.label}</small></span>
          <div className="quick-switcher-accent-dots" role="group" aria-label="Cor de destaque">{UI_ACCENT_REGISTRY.map((accent) => <button key={accent.id} type="button" className={`accent-choice accent-${accent.id}${preferences.accent === accent.id ? ' active' : ''}`} aria-label={`Destaque: ${accent.label}`} aria-pressed={preferences.accent === accent.id} title={accent.label} onClick={() => update({ accent: accent.id })}><i/></button>)}</div>
        </div>
      </div>

      <div className="quick-switcher-layout-grid single">
        <CompactChoice label="Densidade" value={preferences.density === 'compact' ? 'Compacta' : 'Normal'}>
          <div className="quick-switcher-segments two">{(['default', 'compact'] as UIDensity[]).map((density) => <button type="button" key={density} className={preferences.density === density ? 'active' : ''} aria-label={`Densidade: ${density === 'compact' ? 'Compacta' : 'Normal'}`} aria-pressed={preferences.density === density} onClick={() => update({ density })}>{density === 'compact' ? 'Compacta' : 'Normal'}</button>)}</div>
        </CompactChoice>
      </div>

      <details className="quick-switcher-advanced">
        <summary><span><strong>Mais opções</strong><small>Barras e esquema do conteúdo</small></span><Icon name="chevron" size={11}/></summary>
        <div className="quick-switcher-advanced-body">
          <CompactChoice label="Barras de ferramentas" value={preferences.toolRailPlacement === 'sides' ? 'Laterais' : 'Cantos inferiores'}>
            <div className="quick-switcher-segments two"><button type="button" className={preferences.toolRailPlacement === 'sides' ? 'active' : ''} onClick={() => update({ toolRailPlacement: 'sides' })}>Laterais</button><button type="button" className={preferences.toolRailPlacement === 'bottom' ? 'active' : ''} onClick={() => update({ toolRailPlacement: 'bottom' })}>Cantos inferiores</button></div>
          </CompactChoice>
          <label className="quick-switcher-control compact">
            <span><strong>Conteúdo</strong><small>Editor e superfícies de leitura</small></span>
            <span className="quick-switcher-select-shell"><select aria-label="Esquema do conteúdo" value={preferences.contentScheme} onChange={(event) => update({ contentScheme: event.target.value as ContentSchemePreference })}>{CONTENT_SCHEMES.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.label}</option>)}</select><Icon name="chevron" size={11}/></span>
          </label>
        </div>
      </details>
    </div>}
  </div>
}

function CompactChoice({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return <section className="quick-switcher-compact-choice"><div><strong>{label}</strong><small>{value}</small></div>{children}</section>
}
