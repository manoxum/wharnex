import { translate as uiText } from '../../../../lib/workspace/localization'
import type { ReactNode } from 'react'
import { Button, StatusBadge } from '../../../presentation/workbench'
import { SettingsPage } from '../presentation'

export function ConnectionSettingsFrame({ title, description, notice, catalogOpen, onCatalog, children }: {
  title: string; description: string; notice: ReactNode; catalogOpen: boolean; onCatalog: () => void; children: ReactNode
}) {
  return <SettingsPage title={title} description={description}>
    <div><Button icon={catalogOpen ? 'close' : 'plus'} aria-expanded={catalogOpen} onClick={onCatalog}>{catalogOpen ? uiText("Fechar catálogo") : uiText("Adicionar provider")}</Button></div>
    <p className="!m-0 border-l-2 border-whx-border pl-3 !text-whx-caption !leading-relaxed !text-whx-faint">{notice}</p>
    {children}
  </SettingsPage>
}
export function ConnectionSaveBar({ count, noun, busy, onSave }: { count: number; noun: string; busy: boolean; onSave: () => void }) {
  return <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-whx-border-soft bg-whx-bg py-3 text-whx-caption text-whx-faint"><span>{count} {noun}</span><Button tone="primary" icon="save" disabled={busy} onClick={onSave}>{busy ? uiText("A guardar…") : uiText("Guardar configuração")}</Button></div>
}
export function ConnectionStatus({ warning, children }: { warning: boolean; children: ReactNode }) {
  return <div role="status" className="grid gap-2 text-whx-label text-whx-soft"><StatusBadge tone={warning ? 'warning' : 'success'} icon={warning ? 'info' : 'check'}>{uiText("Configuração guardada")}</StatusBadge><p className="!m-0 !text-whx-caption !leading-relaxed !text-whx-faint">{children}</p></div>
}
