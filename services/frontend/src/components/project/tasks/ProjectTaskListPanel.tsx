import type { ReactNode } from 'react'

export function ProjectTaskListPanel({ children }: { children: ReactNode }) {
  return <div id="project-task-panel" className="project-task-list grid min-h-0 auto-rows-max content-start has-[>[data-empty-state]]:not-has-[>article]:content-center items-start gap-[9px] overflow-x-hidden overflow-y-auto bg-transparent p-2.5" role="tabpanel">{children}</div>
}
