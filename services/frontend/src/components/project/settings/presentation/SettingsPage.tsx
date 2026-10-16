import type { ReactNode } from 'react'

export function SettingsPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="mx-auto grid min-w-0 max-w-[880px] gap-6 p-6 max-[760px]:p-4">
    <div><h3 className="!mb-2 !mt-0 !text-whx-heading !font-semibold !text-whx-text">{title}</h3><p className="!m-0 !text-whx-label !leading-relaxed !text-whx-faint">{description}</p></div>{children}
  </section>
}
export function SettingsGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="grid min-w-0 gap-4 border-t border-whx-border-soft pt-5"><div><h4 className="!m-0 !text-whx-title !font-semibold !text-whx-text">{title}</h4><p className="!mb-0 !mt-1 !text-whx-caption !leading-relaxed !text-whx-faint">{description}</p></div>{children}</section>
}
