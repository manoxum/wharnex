const focused = '[&_.workspace-drawer-backdrop]:!hidden [&_.workspace-side-rail]:!hidden [&_.workspace-side-drawer]:!hidden [&_.workspace-side-splitter]:!hidden [&_.terminal-workspace]:!hidden [&_.workbench-operational-panel]:!hidden [&_.terminal-resizer]:!hidden'
const distractionFree = '[&_.workspace-topbar]:!hidden [&_.workbench-status-bar]:!hidden [&_.multi-project-bar]:!hidden [&_.editor-tabbar]:!box-border [&_.editor-tabbar]:!pr-10 [&_.orchestrator-workspace>header]:!pr-10'
const workspaceFrame = 'box-border !px-0.5 !pt-0.5 !bg-[color-mix(in_srgb,var(--theme-bg)_92%,var(--theme-text))]'

export function workbenchPresentation(focus: boolean, zen = false) {
  return `workspace-root ${workspaceFrame} ${focus || zen ? focused : ''} ${zen ? distractionFree : ''}`
}
