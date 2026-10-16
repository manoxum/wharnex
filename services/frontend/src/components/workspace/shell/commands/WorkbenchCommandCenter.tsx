import { lazy, Suspense, useEffect, useState } from 'react'
import type { FileEntry, Session, WorkspaceMode } from '../../../../types'
import type { Drawer } from '../../../../lib/workspace/layout/workspaceDrawer'
import { WORKBENCH_NAVIGATION_LAYOUT } from '../../../../lib/workspace/layout/workspaceRailLayout'
import { api } from '../../../../lib/transport/http/api'
import { workspaceToolMeta } from '../workspaceToolPresentation'
import { CommandPalette, type WorkbenchCommand } from './CommandPalette'
import { IconButton } from '../../../presentation/workbench'
import { ContentSkeleton } from '../../../presentation/chrome/Skeleton'

const SearchPalette = lazy(() => import('../../../editor/canvas/EditorSearchPalette').then((module) => ({ default: module.EditorSearchPalette })))
export function WorkbenchCommandCenter({ session, onMode, onTool, onOpenFile, onSettings, onTerminal, onFocus, onRestore, zenMode, onZen }: {
  session: Session; onMode: (mode: WorkspaceMode) => void; onTool: (drawer: Drawer) => void
  onOpenFile: (path: string, line?: number, column?: number) => void
  onSettings: () => void; onTerminal: () => void; onFocus: () => void; onRestore: () => void; zenMode?: boolean; onZen?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState<'files' | 'project'>()
  const [files, setFiles] = useState<FileEntry[]>([])
  const [fileError, setFileError] = useState('')
  const [filesLoading, setFilesLoading] = useState(false)
  const [fileRevision, setFileRevision] = useState(0)
  useEffect(() => {
    const show = () => setOpen(true)
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); setOpen((current) => !current) }
    }
    const message = (event: MessageEvent) => {
      if (event.source === window.parent && event.origin === window.location.origin && event.data?.type === 'wharnex:open-commands') show()
    }
    window.addEventListener('wharnex:open-commands', show); window.addEventListener('keydown', keyboard); window.addEventListener('message', message)
    return () => { window.removeEventListener('wharnex:open-commands', show); window.removeEventListener('keydown', keyboard); window.removeEventListener('message', message) }
  }, [])
  useEffect(() => {
    if (!open && search !== 'files') return
    let alive = true
    setFileError(''); setFiles([]); setFilesLoading(true)
    void api.listFiles(session.id).then((result) => { if (alive) setFiles(result.files) }).catch((error) => { if (alive) setFileError(error instanceof Error ? error.message : 'Não foi possível carregar os ficheiros.') }).finally(() => { if (alive) setFilesLoading(false) })
    return () => { alive = false }
  }, [open, search, session.id, fileRevision])
  const commands: WorkbenchCommand[] = [
    { id: 'files', group: 'Ações', label: 'Localizar ficheiro', description: 'Abrir um ficheiro do projeto no editor', icon: 'file', run: () => setSearch('files') },
    { id: 'search', label: 'Pesquisar em todo o projeto', description: 'Texto, símbolos e expressões no código', icon: 'search', run: () => setSearch('project') },
    ...(['editor', 'agent', 'orchestrator'] as const).map((mode) => ({ id: `mode-${mode}`, label: mode === 'editor' ? 'Editor' : mode === 'agent' ? 'Agent' : 'Orquestração', description: 'Mudar de contexto preservando o trabalho aberto', icon: mode === 'editor' ? 'code' as const : mode === 'agent' ? 'agent' as const : 'plan' as const, run: () => onMode(mode) })),
    ...WORKBENCH_NAVIGATION_LAYOUT.left.filter((tool) => tool !== 'evolution' || session.self_evolution).map((tool) => { const meta = workspaceToolMeta(tool, { terminalOpen: false, pendingCommitCount: 0, savedChatCount: 0 }); return { id: tool, label: meta.label, description: meta.title, icon: meta.icon, run: () => meta.drawer && onTool(meta.drawer) } }),
    { id: 'terminal', group: 'Ferramentas', label: 'Alternar terminal', description: 'Mostrar ou recolher as sessões do terminal', icon: 'terminal', run: onTerminal },
    { id: 'settings', group: 'Definições', label: 'Definições', description: 'Editor, aparência, modelos, agentes, segurança, armazenamento e integrações', icon: 'settings', run: onSettings },
    { id: 'focus', group: 'Workspace', label: 'Modo de concentração', description: 'Recolher ou restaurar painéis sem fechar recursos', icon: 'monitor', run: onFocus },
    { id: 'restore', label: 'Restaurar layout padrão', description: 'Repor ferramentas e dimensões dos painéis', icon: 'reset', run: onRestore },
  ]
  if (onZen) commands.push({ id: 'zen', label: zenMode ? 'Sair do modo sem distrações' : 'Modo sem distrações', description: 'Concentrar o conteúdo, ocultar chrome e restaurar sem perder estado', icon: 'monitor', group: 'Workspace', run: onZen })
  const fileCommands: WorkbenchCommand[] = files.filter((file) => file.kind === 'file').map((file) => ({ id: `file:${file.path}`, label: file.name || file.path.split('/').at(-1) || file.path, description: file.path, group: 'Ficheiros', icon: 'file', run: () => onOpenFile(file.path) }))
  return <>
    {zenMode && <IconButton className="!fixed !right-2 !top-0.5 !z-[100]" label="Sair do modo sem distrações · Esc" icon="monitor" onClick={onZen}/>}
    {open && <CommandPalette commands={[...commands, ...fileCommands]} loading={filesLoading} error={fileError} onRetry={() => setFileRevision((value) => value + 1)} onClose={() => setOpen(false)}/>}
    {search && <Suspense fallback={<ContentSkeleton label="A abrir pesquisa" rows={3}/>}>
      <SearchPalette mode={search} sessionId={session.id} files={files} loadingFiles={filesLoading} filesError={fileError} onRetryFiles={() => setFileRevision((value) => value + 1)} onClose={() => setSearch(undefined)} onOpen={(path, line, column) => { setSearch(undefined); onOpenFile(path, line, column) }}/>
    </Suspense>}
  </>
}
