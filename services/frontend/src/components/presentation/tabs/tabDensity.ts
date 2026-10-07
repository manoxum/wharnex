export type TabDensity = 'full' | 'compact' | 'icons'
export interface TabWidths { full: number; compact: number }

export function tabDensity(available: number, widths: TabWidths): TabDensity {
  if (available >= widths.full) return 'full'
  if (available >= widths.compact) return 'compact'
  return 'icons'
}
