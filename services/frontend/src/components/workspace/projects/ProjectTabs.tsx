import type { CSSProperties, Ref } from 'react'
import { Icon } from '../../presentation/chrome/Icon'
import { projectMarkChrome, projectTypingChrome } from './projectTabChrome'
import { TabBar, TabButton } from '../../presentation/tabs'

export function ProjectTabs({ projects, activeProject, composerTypingProject, busy, projectWindowOpen, activeButtonRef, accentStyle, projectName, onActiveMenu, onActivate, onUnbind }: {
  projects: string[]; activeProject: string; composerTypingProject?: string; busy: boolean; projectWindowOpen: boolean; activeButtonRef: Ref<HTMLButtonElement>
  accentStyle: (path: string) => CSSProperties; projectName: (path: string) => string; onActiveMenu: (button: HTMLButtonElement) => void
  onActivate: (path: string) => void; onUnbind: (path: string) => void
}) {
  return <TabBar appearance="project" label="Projetos vinculados" className="min-w-0 [-webkit-app-region:no-drag]">
    {projects.map((path) => {
      const active = path === activeProject
      const typing = active && composerTypingProject === path
      return <div key={path} style={accentStyle(path)} data-resource-tab data-selected={active} className="group/project relative inline-flex shrink-0 items-center [--project-hue:92]">
        <TabButton ref={active ? activeButtonRef : undefined} label={projectName(path)} appearance="project" trailingIcon={active ? 'chevron' : undefined} className={typing ? projectTypingChrome : ''} icon={<span data-project-mark className={projectMarkChrome}><Icon name="workspace" size={13}/></span>}
          selected={active} title={active ? `${path} · clique para ver projetos abertos` : path} aria-expanded={active ? projectWindowOpen : undefined}
          onClick={(event) => { if (active) onActiveMenu(event.currentTarget); else onActivate(path) }}/>
        <button type="button" className="absolute right-1 top-1/2 z-2 grid size-[22px] -translate-y-1/2 cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent p-0 text-whx-faint opacity-0 transition-[opacity,background,color] duration-120 group-hover/project:opacity-100 group-data-[selected=true]/project:opacity-100 focus-visible:opacity-100 hover:enabled:bg-[color-mix(in_srgb,var(--danger,#a54038)_15%,transparent)] hover:enabled:text-[var(--danger,#a54038)]" disabled={busy} onClick={() => onUnbind(path)} aria-label={`Desvincular ${projectName(path)} desta janela`} title={`Desvincular ${projectName(path)} desta janela`}><Icon name="close" size={11}/></button>
      </div>
    })}
  </TabBar>
}
