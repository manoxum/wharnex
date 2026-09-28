import { Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AttachmentInspection, ChatFileRecord, ManagedArtifact, OrchestratorTask, ProjectTodo, Session } from '../types'
import { api } from '../lib/api'
import { canonicalDirective, directiveChipLabel, directiveKindLabel, type ComposerDirective } from '../lib/composerDirectives'
import { formatBytes } from '../lib/desktop'
import { ArtifactPreview } from './ArtifactPreview'
import { ArtifactViewerModal, type ArtifactViewerItem } from './ArtifactViewerModal'
import { ChatAttachmentViewer } from './ChatAttachmentViewer'
import { Icon } from './Icon'
import { InternalWindow } from './InternalWindow'

type Props = {
  session: Session
  directive: ComposerDirective
  attachments: File[]
  chatFiles: ChatFileRecord[]
  libraryArtifacts: ManagedArtifact[]
  projectTodos: ProjectTodo[]
  orchestratorTasks: OrchestratorTask[]
  onRemove: () => void
}

type ArtifactTarget = {
  sessionId: string
  artifactId?: string
  bundleId?: string
  item: ArtifactViewerItem
}

export function ComposerReferenceThumbnail({ session, directive, attachments, chatFiles, libraryArtifacts, projectTodos, orchestratorTasks, onRemove }: Props) {
  const [viewerOpen, setViewerOpen] = useState(false)
  const task = directive.kind === 'task' ? orchestratorTasks.find((item) => item.id === directive.value) : undefined
  const label = task?.title || directiveChipLabel(directive)
  return <Fragment>
    <span className={`composer-reference-thumbnail ${directive.kind}`} title={canonicalDirective(directive)}>
      <button type="button" className="composer-reference-open" onClick={() => setViewerOpen(true)} aria-label={`Visualizar referência @${directive.kind} ${label}`}>
        <span className="composer-reference-visual" aria-hidden="true"><Icon name={directiveIcon(directive.kind)} size={15}/><b>{directiveBadge(directive.kind)}</b></span>
        <span className="composer-reference-copy"><b>{label}</b><small>{directiveKindLabel(directive.kind)}</small></span>
      </button>
      <button type="button" className="composer-reference-remove" aria-label={`Remover referência @${directive.kind} ${label}`} onClick={onRemove}>×</button>
    </span>
    {viewerOpen && <ComposerReferenceViewer session={session} directive={directive} attachments={attachments} chatFiles={chatFiles} libraryArtifacts={libraryArtifacts} projectTodos={projectTodos} orchestratorTasks={orchestratorTasks} onClose={() => setViewerOpen(false)}/>}
  </Fragment>
}

function ComposerReferenceViewer({ session, directive, attachments, chatFiles, libraryArtifacts, projectTodos, orchestratorTasks, onClose }: Omit<Props, 'onRemove'> & { onClose: () => void }) {
  const artifactTarget = useMemo(() => resolveArtifactTarget(session, directive, chatFiles, libraryArtifacts), [chatFiles, directive, libraryArtifacts, session])
  const uploadedFile = useMemo(() => directive.kind === 'see' && directive.project === 'upload' ? attachments.find((file) => file.name === directive.path) : undefined, [attachments, directive])

  if (artifactTarget) {
    return <ArtifactViewerModal sessionId={artifactTarget.sessionId} artifactId={artifactTarget.artifactId} bundleId={artifactTarget.bundleId} items={[artifactTarget.item]} initialIndex={0} onClose={onClose}/>
  }
  if (uploadedFile) return <ChatAttachmentViewer source={{ file: uploadedFile }} onClose={onClose}/>

  return <ReferenceDetailModal session={session} directive={directive} todo={directive.kind === 'todo' ? projectTodos.find((item) => item.id === directive.value) : undefined} task={directive.kind === 'task' ? orchestratorTasks.find((item) => item.id === directive.value) : undefined} onClose={onClose}/>
}

function ReferenceDetailModal({ session, directive, todo, task, onClose }: { session: Session; directive: ComposerDirective; todo?: ProjectTodo; task?: OrchestratorTask; onClose: () => void }) {
  const [inspection, setInspection] = useState<AttachmentInspection>()
  const [inspectionError, setInspectionError] = useState('')
  const [loading, setLoading] = useState(false)
  const inspectionRequest = useMemo(() => inspectionForDirective(directive), [directive])
  const projectPath = projectPreviewPath(directive)
  const projectFile = projectPath ? session.context.manifest.files.find((file) => file.path === projectPath) : undefined
  const projectDirectoryEntries = projectPath && !projectFile
    ? session.context.manifest.files.filter((file) => file.path.startsWith(`${projectPath.replace(/\/$/, '')}/`)).slice(0, 120)
    : []

  useEffect(() => {
    let alive = true
    if (!inspectionRequest) { setInspection(undefined); setInspectionError(''); setLoading(false); return () => { alive = false } }
    setLoading(true); setInspection(undefined); setInspectionError('')
    const request = inspectionRequest.kind === 'ref'
      ? api.referenceInspection(session.id, inspectionRequest.marker)
      : api.attachmentInspection(session.id, inspectionRequest.marker)
    void request.then((result) => { if (alive) setInspection(result) }).catch((cause) => {
      if (alive) setInspectionError(cause instanceof Error ? cause.message : 'Não foi possível carregar a referência.')
    }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [inspectionRequest, session.id])

  const title = task?.title || directiveChipLabel(directive)
  const body = <InternalWindow title={`Referência ${title}`} onClose={onClose} layerClassName="artifact-viewer-backdrop">
    <section className={`artifact-viewer composer-reference-viewer ${directive.kind}`} role="dialog" aria-modal="false" aria-label={`Visualizar referência @${directive.kind} ${title}`}>
      <header>
        <div className="artifact-viewer-heading">
          <span className="artifact-viewer-kind"><Icon name={directiveIcon(directive.kind)} size={16}/></span>
          <div><strong>{title}</strong><small><span>@{directive.kind}</span><span>{directiveKindLabel(directive.kind)}</span></small></div>
        </div>
        <div className="artifact-viewer-actions"><button type="button" className="icon-button light" onClick={onClose} aria-label="Fechar visualização da referência"><Icon name="close" size={13}/></button></div>
      </header>
      <div className="artifact-viewer-notices"><code className="composer-reference-marker">{canonicalDirective(directive)}</code></div>
      <div className="artifact-viewer-stage is-text composer-reference-stage">
        {directive.kind === 'todo' ? <TodoReference todo={todo} id={directive.value}/> : null}
        {directive.kind === 'task' ? <TaskReference task={task} id={directive.value}/> : null}
        {projectFile && projectPath ? <ArtifactPreview sessionId={session.id} path={projectPath} url={api.filePreviewURL(session.id, projectPath)} size={projectFile.size}/> : null}
        {!projectFile && projectDirectoryEntries.length > 0 ? <ReferenceEntryList title={`${projectDirectoryEntries.length} ficheiro(s) no diretório`} entries={projectDirectoryEntries.map((file) => ({ path: file.path, size: file.size, status: 'included' }))}/> : null}
        {loading ? <div className="artifact-preview-empty"><span className="spinner"/>A resolver a referência…</div> : null}
        {inspectionError ? <div className="artifact-preview-empty composer-error"><Icon name="alert" size={22}/><strong>Referência indisponível</strong><span>{inspectionError}</span></div> : null}
        {inspection ? <InspectionReference inspection={inspection}/> : null}
        {!todo && directive.kind === 'todo' ? <ReferenceUnavailable text={`O TODO ${directive.value} já não está disponível no snapshot do projeto.`}/> : null}
        {!task && directive.kind === 'task' ? <ReferenceUnavailable text={`A task ${directive.value} não está no índice local; o backend valida a referência no envio.`}/> : null}
        {!loading && !inspection && !inspectionError && !projectFile && !projectDirectoryEntries.length && directive.kind !== 'todo' && directive.kind !== 'task' ? <ReferenceUnavailable text={referenceFallback(directive)}/> : null}
      </div>
    </section>
  </InternalWindow>
  return createPortal(body, document.body)
}

function TodoReference({ todo, id }: { todo?: ProjectTodo; id: string }) {
  if (!todo) return null
  return <div className="composer-reference-detail todo-detail">
    <div className="composer-reference-facts"><span><b>Estado</b>{todo.status === 'done' ? 'Concluído' : 'Aberto'}</span>{todo.kind && <span><b>Tipo</b>{todo.kind}</span>}{todo.urgency && <span><b>Urgência</b>{todo.urgency}</span>}<span><b>ID</b>{id}</span></div>
    <h3>{todo.body}</h3>
    {todo.description && <p>{todo.description}</p>}
    {todo.pre_plan?.length ? <><h4>Pré-plano</h4><ul>{todo.pre_plan.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></> : null}
    {todo.project_files?.length ? <><h4>Ficheiros do projeto</h4><ul>{todo.project_files.map((path) => <li key={path}><code>{path}</code></li>)}</ul></> : null}
    {todo.attachments?.length ? <><h4>Anexos</h4><ul>{todo.attachments.map((attachment) => <li key={attachment.storage_ref}>{attachment.name} · {formatBytes(attachment.size)}</li>)}</ul></> : null}
  </div>
}


function TaskReference({ task, id }: { task?: OrchestratorTask; id: string }) {
  if (!task) return null
  return <div className="composer-reference-detail task-detail">
    <div className="composer-reference-facts"><span><b>Estado</b>{task.status === 'ARCHIVED' ? 'Arquivada após conclusão' : 'Concluída'}</span><span><b>ID</b>{id}</span>{task.plan_id && <span><b>Plano</b>{task.plan_id}</span>}<span><b>Atualizada</b>{new Date(task.updated_at).toLocaleString('pt-PT')}</span></div>
    <h3>{task.title}</h3>
    {task.description && <p>{task.description}</p>}
    {task.acceptance_criteria?.length ? <><h4>Critérios de aceitação</h4><ul>{task.acceptance_criteria.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></> : null}
    {task.depends_on?.length ? <><h4>Dependências</h4><ul>{task.depends_on.map((item) => <li key={item}><code>{item}</code></li>)}</ul></> : null}
  </div>
}

function InspectionReference({ inspection }: { inspection: AttachmentInspection }) {
  const entries = inspection.entries.slice(0, 160)
  return <div className="composer-reference-detail inspection-detail">
    <div className="composer-reference-facts"><span><b>Raiz</b>{inspection.root}</span><span><b>Tipo</b>{inspection.kind}</span><span><b>Incluídos</b>{inspection.included_files} ficheiro(s)</span><span><b>Tamanho</b>{formatBytes(inspection.included_bytes)}</span>{inspection.excluded_items > 0 && <span><b>Excluídos</b>{inspection.excluded_items}</span>}</div>
    {inspection.truncated && <div className="artifact-preview-warning">A inventariação foi truncada pelos limites de contexto.</div>}
    {entries.length ? <ReferenceEntryList title={`${entries.length}${inspection.entries.length > entries.length ? '+' : ''} entrada(s) visíveis`} entries={entries}/> : <ReferenceUnavailable text="A referência não contém ficheiros visíveis no contexto atual."/>}
  </div>
}

function ReferenceEntryList({ title, entries }: { title: string; entries: Array<{ path: string; size?: number; status?: string }> }) {
  return <div className="composer-reference-entry-list"><h4>{title}</h4><ul>{entries.map((entry) => <li key={entry.path}><span><Icon name={entry.path.endsWith('/') ? 'folder' : 'file'} size={12}/><code>{entry.path}</code></span><small>{entry.size !== undefined ? formatBytes(entry.size) : ''}{entry.status && entry.status !== 'included' ? ` · ${entry.status}` : ''}</small></li>)}</ul></div>
}

function ReferenceUnavailable({ text }: { text: string }) {
  return <div className="artifact-preview-empty"><Icon name="info" size={24}/><strong>Detalhes da referência</strong><span>{text}</span></div>
}

function resolveArtifactTarget(session: Session, directive: ComposerDirective, chatFiles: ChatFileRecord[], libraryArtifacts: ManagedArtifact[]): ArtifactTarget | undefined {
  if (directive.kind === 'chat') {
    if (directive.value.startsWith('entry|')) {
      const [, bundleId, path] = directive.value.split('|', 3)
      if (!bundleId || !path) return undefined
      const record = chatFiles.find((item) => item.artifact_id === bundleId && item.path === path)
      return { sessionId: session.id, bundleId, item: { path, size: record?.size || 0, label: record?.name || path, content_type: record?.content_type } }
    }
    const artifactId = directive.value.startsWith('artifact|') ? directive.value.slice('artifact|'.length) : ''
    const artifact = artifactId
      ? (session.artifacts || []).find((item) => item.id === artifactId)
      : [...(session.artifacts || [])].reverse().find((item) => item.name === directive.value)
    if (!artifact) return undefined
    return { sessionId: session.id, artifactId: artifact.id, item: { path: artifact.name, size: artifact.size, label: artifact.name, content_type: artifact.content_type } }
  }
  if (directive.kind === 'lib') {
    const [prefix, sourceSession, artifactId] = directive.value.split('|')
    if (prefix !== 'session' || !sourceSession || !artifactId) return undefined
    const item = libraryArtifacts.find((candidate) => candidate.session_id === sourceSession && candidate.artifact.id === artifactId)
    if (!item) return undefined
    return { sessionId: sourceSession, artifactId, item: { path: item.artifact.name, size: item.artifact.size, label: item.artifact.name, content_type: item.artifact.content_type } }
  }
  return undefined
}

function inspectionForDirective(directive: ComposerDirective): { kind: 'ref' | 'attach'; marker: string } | undefined {
  if (directive.kind === 'ref' || directive.kind === 'attach') return { kind: directive.kind, marker: canonicalDirective(directive) }
  if (directive.kind !== 'see') return undefined
  if (directive.value.startsWith('ref|')) {
    return { kind: 'ref', marker: canonicalDirective({ kind: 'ref', value: `${directive.project}/${directive.path}` }) }
  }
  if (directive.value.startsWith('attach|')) {
    const root = directive.project.replace(/\/$/, '')
    return { kind: 'attach', marker: canonicalDirective({ kind: 'attach', value: `${root}/${directive.path}` }) }
  }
  return undefined
}

function projectPreviewPath(directive: ComposerDirective) {
  if (directive.kind === 'file') return directive.path
  if (directive.kind === 'see' && directive.project === 'project') return directive.path
  return ''
}

function referenceFallback(directive: ComposerDirective) {
  if (directive.kind === 'chat') return 'O artefacto referido já não está indexado neste chat.'
  if (directive.kind === 'lib') return 'O artefacto referido já não está disponível na biblioteca carregada.'
  if (directive.kind === 'task') return `Task ${directive.value}`
  if (directive.kind === 'see' && directive.project === 'upload') return 'O upload referido já não está presente no composer.'
  if (directive.kind === 'see') return `Fonte ${directive.project || 'desconhecida'} · ${directive.path}`
  if (directive.kind === 'file') return `O caminho ${directive.path} não está presente no manifesto atual.`
  return canonicalDirective(directive)
}

function directiveBadge(kind: ComposerDirective['kind']) {
  if (kind === 'file') return 'FILE'
  if (kind === 'ref') return 'REF'
  if (kind === 'attach') return 'EXT'
  if (kind === 'see') return 'SEE'
  if (kind === 'chat') return 'CHAT'
  if (kind === 'lib') return 'LIB'
  if (kind === 'task') return 'TASK'
  return 'TODO'
}

function directiveIcon(kind: ComposerDirective['kind']): Parameters<typeof Icon>[0]['name'] {
  if (kind === 'attach') return 'folder'
  if (kind === 'todo' || kind === 'task') return 'check'
  if (kind === 'file') return 'file'
  if (kind === 'see') return 'link'
  if (kind === 'chat') return 'history'
  if (kind === 'lib') return 'archive'
  return 'workspace'
}
