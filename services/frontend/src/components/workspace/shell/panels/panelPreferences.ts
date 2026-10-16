import { desktopWindowScope } from '../../../../lib/project/context/projectBindings'
import { WORKSPACE_DRAWERS, type Drawer } from '../../../../lib/workspace/layout/workspaceDrawer'
const PANEL_FONT_SCALE_KEY = 'whx.workspace.panel-font-scales.v1'
const PANEL_FONT_SCALE_MIN = 0.8
const PANEL_FONT_SCALE_MAX = 1.4

function panelFontScaleKey() { return `${PANEL_FONT_SCALE_KEY}:${desktopWindowScope()}` }
export function loadPanelFontScales(): Partial<Record<Exclude<Drawer, ''>, number>> {
  try {
    const parsed = JSON.parse(localStorage.getItem(panelFontScaleKey()) || '{}') as Record<string, unknown>
    const scales: Partial<Record<Exclude<Drawer, ''>, number>> = {}
    for (const candidate of WORKSPACE_DRAWERS) {
      const value = Number(parsed[candidate])
      if (Number.isFinite(value)) scales[candidate] = Math.min(PANEL_FONT_SCALE_MAX, Math.max(PANEL_FONT_SCALE_MIN, value))
    }
    return scales
  } catch { return {} }
}
export function savePanelFontScales(scales: Partial<Record<Exclude<Drawer, ''>, number>>) {
  try { localStorage.setItem(panelFontScaleKey(), JSON.stringify(scales)) } catch { /* best effort */ }
}
export function rootUIFontScale() {
  if (typeof document === 'undefined') return 1
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-font-scale'))
  return Number.isFinite(value) && value > 0 ? value : 1
}
