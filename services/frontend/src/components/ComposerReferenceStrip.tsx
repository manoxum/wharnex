import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api'
import { canonicalDirective, directiveKindLabel, type ComposerDirective, type DirectiveKind } from '../lib/composerDirectives'
import type { AttachmentInspection, ChatFileRecord, ManagedArtifact, ProjectTodo, WorkspaceFile } from '../types'
import { ArtifactViewerModal } from './ArtifactViewerModal'
import { BundleExplorerModal } from './BundleExplorer'
import { ChatAttachmentViewer } from './ChatAttachmentViewer'
import { Icon } from './Icon'

export function ComposerReferenceStrip({ sessionId, directives, todos, chatFiles, libraryArtifacts, uploads, onRemove }: {
  sessionId: string
  directives: ComposerDirective[]
  todos: ProjectTodo[]
  chatFiles: ChatFileRecord[]
  libraryArtifacts: ManagedArtifact[]
  uploads: File[]
  onRemove: (directive: ComposerDirective) => void
}) {
  const [selected, setSelected] = useState<ComposerDirective>()
  if (!directives.length) return null
  return <Fragment>
    <div className="composer-reference-thumbnails" aria-label="Referências do composer">
      {directives.map((directive, index) => {
        const meta = referenceMeta(directive, todos, chatFiles, libraryArtifacts)
        return <article className={`composer-reference-thumbnail kind-${directive.kind}`} key={`${directive.start}:${directive.end}:${index}`}>
          <button type="button" className="composer-reference-open" onClick={() => setSelected(directive)} aria-label={`Visualizar ${meta.label}`} title={canonicalDirective(directive)}>
            <span className="composer-reference-visual" aria-hidden="true"><Icon name={referenceIcon(directive.kind)} size={16}/><b>@{directive.kind}</b></span>
            <span className="composer-reference-copy"><strong>{meta.label}</strong><small>{meta.detail}</small></span>
          </button>
          <button type="button" className="composer-reference-remove" aria-label={`Remover ${meta.label}`} onClick={() => onRemove(directive)}>×</button>
        </article>
      })}
    </div>
    {selected && <ComposerReferenceViewer sessionId={sessionId} directive={selected} todos={todos} chatFiles={chatFiles} libraryArtifacts={libraryArtifacts} uploads={uploads} onClose={() => setSelected(undefined)}/>} 
  </Fragment>
}

function ComposerReferenceViewer({ sessionId, directive, todos, chatFiles, libraryArtifacts, uploads, onClose }: {
  sessionId: string
  directive: ComposerDirective
  todos: ProjectTodo[]
  chatFiles: ChatFileRecord[]
  libraryArtifacts: ManagedArtifact[]
  uploads: File[]
  onClose: () => void
}) {
  const chat = chatReference(directive, chatFiles)
  if (directive.kind === 'chat' && chat) {
    const item = { path: chat.path || chat.name, size: chat.size, content_type: chat.content_type, label: chat.name, description: chat.source === 'attachment' ? 'Anexo enviado neste chat' : 'Artefacto já vinculado a este chat' }
    return chat.direct
      ? <ArtifactViewerModal sessionId={sessionId} artifactId={chat.artifact_id} items={[item]} initialIndex={0} onClose={onClose}/>
      : <ArtifactViewerModal sessionId={sessionId} bundleId={chat.artifact_id} items={[item]} initialIndex={0} onClose={onClose}/>
  }
  const library = libraryReference(directive, libraryArtifacts)
  if (directive.kind === 'lib' && library) {
    if (library.artifact.bundle) return <BundleExplorerModal sessionId={library.session_id} bundle={library.artifact} onClose={onClose}/>
    return <ArtifactViewerModal sessionId={library.session_id} artifactId={library.artifact.id} items={[{ path: library.artifact.name, size: library.artifact.size, content_type: library.artifact.content_type, label: library.artifact.name, description: `Biblioteca · ${library.project_path}` }]} initialIndex={0} onClose={onClose}/>
  }
  if (directive.kind === 'see' && directive.project === 'upload') {
    const file = uploads.find((candidate) => candidate.name === directive.path)
    if (file) return <ChatAttachmentViewer source={{ file }} onClose={onClose}/>
  }
  return <ReferenceDetailsModal sessionId={sessionId} directive={directive} todo={todos.find((item) => item.id === directive.value)} onClose={onClose}/>
}

function ReferenceDetailsModal({ sessionId, directive, todo, onClose }: { sessionId: string; directive: ComposerDirective; todo?: ProjectTodo; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [file, setFile] = useState<WorkspaceFile>()
  const [inspection, setInspection] = useState<AttachmentInspection>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); previous?.focus() }
  }, [onClose])

  useEffect(() => {
    let alive = true
    setFile(undefined); setInspection(undefined); setError('')
    const projectPath = directive.kind === 'file' ? directive.path : directive.kind === 'see' && directive.project === 'project' ? directive.path : ''
    const inspect = directive.kind === 'attach' ? api.attachmentInspection(sessionId, canonicalDirective(directive))
      : directive.kind === 'ref' ? api.referenceInspection(sessionId, canonicalDirective(directive))
        : undefined
    if (!projectPath && !inspect) return () => { alive = false }
    setLoading(true)
    const pending = projectPath ? api.readFile(sessionId, projectPath).then((value) => { if (alive) setFile(value) }) : inspect!.then((value) => { if (alive) setInspection(value) })
    void pending.catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a referência.') }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [directive, sessionId])

  const meta = detailsMeta(directive, todo)
  const body = <div className="composer-reference-viewer-backdrop" data-chatgpt-overlay-blocker="true" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className={`composer-reference-viewer kind-${directive.kind}`} role="dialog" aria-modal="true" aria-label={`Visualizar referência @${directive.kind}`}>
      <header><div><span className="composer-reference-viewer-icon"><Icon name={referenceIcon(directive.kind)} size={18}/></span><div><small>{directiveKindLabel(directive.kind)}</small><strong>{meta.title}</strong></div></div><button ref={closeRef} type="button" className="icon-button light" onClick={onClose} aria-label="Fechar referência"><Icon name="close" size={13}/></button></header>
      <div className="composer-reference-viewer-meta"><code>{canonicalDirective(directive)}</code><span>{meta.subtitle}</span></div>
      <div className="composer-reference-viewer-body">
        {loading ? <div className="composer-reference-loading"><span className="spinner"/> A carregar referência…</div> : null}
        {error ? <div className="composer-reference-error"><Icon name="alert" size={16}/><span>{error}</span></div> : null}
        {todo ? <TodoReference todo={todo}/> : null}
        {file ? <FileReference file={file}/> : null}
        {inspection ? <InspectionReference inspection={inspection}/> : null}
        {!loading && !error && !todo && !file && !inspection ? <FallbackReference directive={directive}/> : null}
      </div>
    </section>
  </div>
  return createPortal(body, document.body)
}

function TodoReference({ todo }: { todo: ProjectTodo }) {
  return <div className="composer-reference-detail-stack"><p>{todo.body}</p><dl><dt>Estado</dt><dd>{todo.execution_status || todo.status}</dd><dt>Classificação</dt><dd>{todo.kind || 'por classificar'} · {todo.urgency || 'sem urgência definida'}</dd></dl>{todo.description ? <section><h4>Descrição</h4><p>{todo.description}</p></section> : null}{todo.pre_plan?.length ? <section><h4>Pré-plano</h4><ol>{todo.pre_plan.map((step, index) => <li key={`${todo.id}:${index}`}>{step}</li>)}</ol></section> : null}{todo.project_files?.length ? <section><h4>Ficheiros associados</h4><ul>{todo.project_files.map((path) => <li key={path}><code>{path}</code></li>)}</ul></section> : null}</div>
}

function FileReference({ file }: { file: WorkspaceFile }) {
  return <div className="composer-reference-file"><div><strong>{file.path}</strong><small>{file.size} B · {file.sha256.slice(0, 12)}…</small></div><pre>{file.content}</pre></div>
}

function InspectionReference({ inspection }: { inspection: AttachmentInspection }) {
  const included = inspection.entries.filter((entry) => entry.status === 'included')
  return <div className="composer-reference-detail-stack"><dl><dt>Origem</dt><dd>{inspection.root}</dd><dt>Seleção</dt><dd>{inspection.included_files} ficheiro(s) · {inspection.included_bytes} B</dd><dt>Excluídos</dt><dd>{inspection.excluded_items}{inspection.truncated ? ' · seleção truncada' : ''}</dd></dl><section><h4>Conteúdo incluído</h4>{included.length ? <ul className="composer-reference-inventory">{included.slice(0, 160).map((entry) => <li key={entry.path}><Icon name={entry.kind === 'directory' ? 'folder' : 'file'} size={12}/><code>{entry.path}</code></li>)}</ul> : <p>Nenhum ficheiro incluído.</p>}</section></div>
}

function FallbackReference({ directive }: { directive: ComposerDirective }) {
  return <div className="composer-reference-detail-stack"><p>Esta referência será resolvida quando o pedido for montado.</p><dl><dt>Tipo</dt><dd>@{directive.kind}</dd><dt>Valor</dt><dd>{directive.path || directive.value}</dd>{directive.project ? <><dt>Origem</dt><dd>{directive.project}</dd></> : null}</dl></div>
}

function referenceMeta(directive: ComposerDirective, todos: ProjectTodo[], chatFiles: ChatFileRecord[], libraryArtifacts: ManagedArtifact[]) {
  if (directive.kind === 'todo') { const todo = todos.find((item) => item.id === directive.value); return { label: todo?.body || directive.value, detail: `TODO · ${todo?.execution_status || todo?.status || directive.value}` } }
  if (directive.kind === 'chat') { const file = chatReference(directive, chatFiles); return { label: file?.name || directive.path, detail: `Chat · ${file?.source || 'artefacto vinculado'}` } }
  if (directive.kind === 'lib') { const item = libraryReference(directive, libraryArtifacts); return { label: item?.artifact.name || directive.path, detail: `Biblioteca${item ? ` · ${item.project_path}` : ''}` } }
  if (directive.kind === 'ref') return { label: directive.path ? `${directive.project}/${directive.path}` : directive.project, detail: 'Projeto paralelo' }
  if (directive.kind === 'attach') return { label: baseName(directive.path), detail: `Externo · ${directive.path}` }
  if (directive.kind === 'file') return { label: baseName(directive.path), detail: `Projeto · ${directive.path}` }
  return { label: baseName(directive.path || directive.value), detail: `@see · ${directive.project || 'referência'}` }
}

function detailsMeta(directive: ComposerDirective, todo?: ProjectTodo) {
  const meta = referenceMeta(directive, todo ? [todo] : [], [], [])
  return { title: meta.label, subtitle: meta.detail }
}

function chatReference(directive: ComposerDirective, files: ChatFileRecord[]) {
  if (directive.kind !== 'chat') return undefined
  const parts = directive.value.split('|')
  if (parts[0] === 'artifact' && parts[1]) return files.find((file) => file.artifact_id === parts[1] && file.direct)
  if (parts[0] === 'entry' && parts[1]) return files.find((file) => file.artifact_id === parts[1] && (file.path || '') === (parts[2] || ''))
  return undefined
}

function libraryReference(directive: ComposerDirective, items: ManagedArtifact[]) {
  if (directive.kind !== 'lib') return undefined
  const parts = directive.value.split('|')
  if (parts[0] !== 'session' || !parts[1] || !parts[2]) return undefined
  return items.find((item) => item.session_id === parts[1] && item.artifact.id === parts[2])
}

function referenceIcon(kind: DirectiveKind): 'file' | 'workspace' | 'folder' | 'link' | 'package' | 'plan' | 'search' {
  if (kind === 'ref') return 'workspace'
  if (kind === 'attach') return 'folder'
  if (kind === 'chat') return 'link'
  if (kind === 'lib') return 'package'
  if (kind === 'todo') return 'plan'
  if (kind === 'see') return 'search'
  return 'file'
}

function baseName(path: string) { return path.split('/').filter(Boolean).pop() || path }
