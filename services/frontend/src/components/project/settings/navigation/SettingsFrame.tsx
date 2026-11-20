import { translate as uiText } from '../../../../lib/workspace/localization'
import { useState, type ReactNode } from 'react'
import { Icon } from '../../../presentation/chrome/Icon'
import { Button, EmptyState, Input, Select, StatusBadge } from '../../../presentation/workbench'
import { SETTINGS_SECTIONS, type SettingsSection } from './settingsCatalog'
import { WindowPanelHeader } from '../../../workspace/window/chrome'

export function SettingsFrame({ projectPath, section, onSection, onClose, children, dirty = false, saving = false, onSave }: {
  projectPath?: string; section: SettingsSection; onSection: (section: SettingsSection) => void; onClose: () => void
  children: ReactNode; dirty?: boolean; saving?: boolean; onSave?: () => void
}) {
  const [query, setQuery] = useState('')
  const notice = section === 'data' ? 'Os ficheiros dos projetos reais não são removidos pelas operações desta secção.' : section === 'remote-storage' ? 'A configuração de storage é global e aplica-se a todos os projetos após reiniciar.' : undefined
  const compact = section === 'composer' || section === 'workspace' || section === 'language'
  const sections = SETTINGS_SECTIONS.filter((item) => !item.project || projectPath).map((item) => ({ ...item, group: uiText(item.group), label: uiText(item.label), description: uiText(item.description) }))
  const filtered = sections.filter((item) => `${item.group} ${item.label} ${item.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()))
  return <section data-workbench-settings className={`flex ${compact ? 'h-[min(660px,calc(100dvh-48px))] w-[min(960px,calc(100vw-32px))]' : 'h-[min(860px,calc(100dvh-48px))] w-[min(1160px,calc(100vw-32px))]'} min-w-0 flex-col overflow-hidden rounded-xl border border-whx-border text-whx-body !bg-whx-workspace [[data-internal-window-sized=true]_&]:!h-full [[data-internal-window-sized=true]_&]:!w-full [[data-internal-window-maximized=true]_&]:!h-full [[data-internal-window-maximized=true]_&]:!w-full text-whx-text`} role="dialog" aria-modal="false" aria-label={uiText("Configurações")}>
    <WindowPanelHeader title={uiText("Configurações")} description={uiText("Personalize o seu ambiente e administre o projeto.")} icon="settings" onClose={onClose} closeLabel="Fechar configurações"/>
    <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] max-[760px]:grid-cols-1 max-[760px]:grid-rows-[auto_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-y-auto bg-whx-side p-3 max-[760px]:border-b max-[760px]:border-whx-border-soft">
        <div className="mb-4 grid gap-1 px-2 max-[760px]:hidden"><small className="text-whx-caption text-whx-faint">{projectPath ? uiText("Projeto atual") : uiText("Escopo")}</small><strong className="truncate text-whx-label" title={projectPath}>{projectPath?.split('/').filter(Boolean).at(-1) || 'Global'}</strong><span className="truncate font-mono text-whx-caption text-whx-faint" title={projectPath}>{projectPath || 'Desktop e novos projetos'}</span></div>
        <div className="mb-3 max-[760px]:hidden"><Input aria-label={uiText("Pesquisar definições")} placeholder={uiText("Pesquisar definições…")} value={query} onChange={(event) => setQuery(event.target.value)} className="!w-full"/></div>
        <Select className="!hidden !w-full max-[760px]:!block" aria-label={uiText("Categoria das configurações")} value={section} onChange={(event) => onSection(event.target.value as SettingsSection)}>{sections.map((item) => <option key={item.id} value={item.id}>{item.group} · {item.label}</option>)}</Select>
        <nav aria-label={uiText("Secções das configurações")} className="grid gap-1 max-[760px]:hidden">
          {filtered.map((item, index) => <div key={item.id}>
            {(index === 0 || item.group !== filtered[index - 1].group) && <span className="mb-1 mt-3 block px-2 text-whx-caption font-medium text-whx-faint">{item.group}</span>}
            <button type="button" aria-current={section === item.id ? 'page' : undefined} className={`!flex !w-full !items-center !gap-3 !rounded-md !border-0 !px-2 !py-2.5 !text-left !shadow-none focus-visible:!outline-whx-accent ${section === item.id ? '!bg-whx-hover !text-whx-text' : '!bg-transparent !text-whx-faint hover:!bg-whx-hover hover:!text-whx-text'}`} onClick={() => onSection(item.id)}>
              <Icon name={item.icon} size={17}/><span className="min-w-0"><strong className="block text-whx-label font-medium">{item.label}</strong><small className="mt-0.5 block text-whx-caption text-whx-faint">{item.description}</small></span>
            </button>
          </div>)}
          {!filtered.length && <EmptyState compact title={uiText("Nenhuma categoria encontrada")} icon="search" description={uiText("Procure por tema, contexto, limites ou uma integração.")}/>}
        </nav>
      </aside>
      <main className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto bg-whx-bg [scrollbar-width:thin]" aria-label={sections.find((item) => item.id === section)?.label}>{children}</main>
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-whx-border-soft bg-whx-surface px-4 py-3">
      {notice && <p role="note" className="!m-0 mr-auto text-whx-caption leading-relaxed text-whx-faint">{uiText(notice)}</p>}
      {dirty && <StatusBadge tone="warning" icon="edit">{uiText("Alterações por guardar")}</StatusBadge>}
      {section === 'context' && onSave && <Button tone="primary" icon="save" disabled={saving} onClick={onSave}>{saving ? uiText("A guardar…") : uiText("Guardar e reconstruir contexto")}</Button>}
      <Button onClick={onClose}>{uiText("Fechar")}</Button>
    </footer>
  </section>
}
