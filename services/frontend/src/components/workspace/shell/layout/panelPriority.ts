export type PanelSide = 'left' | 'right'
const key = (projectPath: string) => `wharnex.workbench.panel-priority.v1:${projectPath}`

export function panelPriority(row: HTMLElement, projectPath: string): PanelSide | undefined {
  let value: string | null | undefined
  if (row.dataset.panelPriorityProject === projectPath) value = row.dataset.panelPriority
  else { try { value = localStorage.getItem(key(projectPath)) } catch { /* best effort */ } }
  return value === 'left' || value === 'right' ? value : undefined
}
export function rememberPanelPriority(row: HTMLElement, projectPath: string, side: PanelSide) {
  row.dataset.panelPriorityProject = projectPath
  row.dataset.panelPriority = side
  try { localStorage.setItem(key(projectPath), side) } catch { /* best effort */ }
}
export function resetPanelPriority(projectPath: string) {
  try { localStorage.removeItem(key(projectPath)) } catch { /* best effort */ }
  for (const row of document.querySelectorAll<HTMLElement>('.workspace-main-row[data-panel-priority-project]')) {
    if (row.dataset.panelPriorityProject !== projectPath) continue
    delete row.dataset.panelPriority
    delete row.dataset.panelPriorityProject
  }
}
