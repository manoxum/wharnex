import type { ReactNode } from 'react'

export function SettingsPage({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="mx-auto grid min-w-0 max-w-[880px] gap-4 p-4">
    <h3 title={description} aria-description={description} className="!m-0 !text-whx-heading !font-semibold !leading-snug !text-whx-text">{title}</h3>{children}
  </section>
}
export function SettingsGroup({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="grid min-w-0 gap-3 border-t border-whx-border-soft pt-4"><div><h4 className="!m-0 !text-whx-label !font-semibold !text-whx-text">{title}</h4>{description && <p className="!mb-0 !mt-1 !text-whx-caption !leading-relaxed !text-whx-faint">{description}</p>}</div>{children}</section>
}
