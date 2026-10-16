const focused = '[&_.workspace-drawer-backdrop]:!hidden [&_.workspace-side-rail]:!hidden [&_.workspace-side-drawer]:!hidden [&_.workspace-side-splitter]:!hidden [&_.terminal-workspace]:!hidden [&_.workbench-operational-panel]:!hidden [&_.terminal-resizer]:!hidden'
const distractionFree = '[&_.workspace-topbar]:!hidden [&_.workbench-status-bar]:!hidden [&_.multi-project-bar]:!hidden [&_.editor-tabbar]:!box-border [&_.editor-tabbar]:!pr-10 [&_.orchestrator-workspace>header]:!pr-10'

export function workbenchPresentation(focus: boolean, zen = false) {
  return `workspace-root ${focus || zen ? focused : ''} ${zen ? distractionFree : ''}`
}
