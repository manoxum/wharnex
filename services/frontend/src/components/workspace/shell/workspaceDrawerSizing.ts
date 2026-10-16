import type { Drawer } from '../../../lib/workspace/layout/workspaceDrawer'

export const PROJECT_EXPLORER_WIDTH_CLASS = 'max-w-[min(420px,max(160px,38vw))]'

export function workspaceDrawerClass(drawer: Drawer) {
  return drawer === 'project' ? PROJECT_EXPLORER_WIDTH_CLASS : ''
}
