import type { ReactNode } from 'react'

export function GitTabContent({ label, stretch, children }: {
  label: string
  stretch: boolean
  children: ReactNode
}) {
  const layout = stretch
    ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
    : 'grid min-h-0 min-w-0 flex-1 content-start overflow-y-auto'

  return <div className={`git-tab-content ${layout} w-full px-0 py-2`} role="tabpanel" aria-label={label}>
    {children}
  </div>
}
