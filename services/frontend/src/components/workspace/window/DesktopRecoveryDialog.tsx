import { ConfirmationDialog } from '../../presentation/dialogs'
function projectName(path: string) { return path.split('/').filter(Boolean).pop() || path }
export function DesktopRecoveryDialog({ projects, busy, onRecover, onDiscard }: { projects: string[]; busy: boolean; onRecover: () => void; onDiscard: () => void }) {
  const many = projects.length > 1
  return <ConfirmationDialog title={many ? `Recuperar os ${projects.length} projetos da última sessão?` : `Recuperar a última sessão de ${projectName(projects[0] || '')}?`} description={`Recuperar repõe ${many ? 'estes workspaces' : 'este workspace'} e o estado persistido de cada um. Descartar remove apenas esta sessão de janela — os chats guardados do projeto são preservados.`} icon="archive" busy={busy} onCancel={onDiscard} initialAction={1} actions={[
    { label: 'Descartar sessão', run: onDiscard }, { label: 'Recuperar sessão', tone: 'primary', icon: 'refresh', run: onRecover },
  ]}>
    <ul className="!m-0 grid max-h-48 list-none gap-1 overflow-y-auto !p-0">{projects.map((path) => <li key={path} className="grid gap-0.5 border-b border-whx-border-soft px-2 py-2"><strong className="text-whx-label font-medium">{projectName(path)}</strong><small title={path} className="truncate text-whx-caption text-whx-faint">{path}</small></li>)}</ul>
  </ConfirmationDialog>
}
