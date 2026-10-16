export type MonitorPanels = { list: boolean; details: boolean }

const COLLAPSED_WIDTH = 44
const MIN_BROWSER_WIDTH = 340

function clamp(value: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, value)))
}

export function monitorPanelWidths(width: number) {
  return {
    list: clamp(width * 0.19, 200, 280),
    details: clamp(width * 0.23, 240, 340),
    policies: clamp(width * 0.28, 240, 340),
  }
}

export function canFitMonitorPanels(width: number, policiesOpen: boolean) {
  const panels = monitorPanelWidths(width)
  const policyWidth = policiesOpen ? panels.policies : 0
  return width >= MIN_BROWSER_WIDTH + panels.list + panels.details + policyWidth
}

export function resolveMonitorPanels(width: number, preferred: MonitorPanels, focused: boolean, policiesOpen: boolean): MonitorPanels {
  if (focused) return { list: false, details: false }
  let { list, details } = preferred
  if (!policiesOpen) return { list, details }

  const sizes = monitorPanelWidths(width)
  const budget = width - MIN_BROWSER_WIDTH - sizes.policies
  if (details && sizes.details + (list ? sizes.list : COLLAPSED_WIDTH) > budget) details = false
  if (list && sizes.list + (details ? sizes.details : COLLAPSED_WIDTH) > budget) list = false
  return { list, details }
}

export function monitorGridColumns(width: number, panels: MonitorPanels, policiesOpen: boolean) {
  const sizes = monitorPanelWidths(width)
  return [
    `${panels.list ? sizes.list : COLLAPSED_WIDTH}px`,
    `${panels.details ? sizes.details : COLLAPSED_WIDTH}px`,
    'minmax(0, 1fr)',
    ...(policiesOpen ? [`${sizes.policies}px`] : []),
  ].join(' ')
}
