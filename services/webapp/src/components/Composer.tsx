import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import type { AppConfig, RequestMode, Session } from '../types'

export type ComposerValue = { text: string; files: File[]; projectFiles: string[]; tunnelIds: string[]; mode: RequestMode; includeContext: boolean }
type Draft = { text: string; projectRefs: string; mode: RequestMode; includeContext: boolean; tunnelIds: string[] }

export function Composer({ session, config, busy, onSend, onSessionChange }: {
  session: Session; config?: AppConfig; busy: boolean; onSend: (value: ComposerValue) => Promise<void>; onSessionChange: (session: Session) => void
}) {
  const draftKey = `wharnex.remote.composer:${session.id}`
  const stored = useMemo(() => loadDraft(draftKey), [draftKey])
  const activeTunnelIDs = useMemo(() => (config?.remote_input?.instances || []).filter((item) => item.available && (item.state || 'active') === 'active').map((item) => item.id), [config])
  const [text, setText] = useState(stored.text)
  const [files, setFiles] = useState<File[]>([])
  const [projectRefs, setProjectRefs] = useState(stored.projectRefs)
  const [mode, setMode] = useState<RequestMode>(stored.mode)
  const [includeContext, setIncludeContext] = useState(stored.includeContext)
  const [tunnelIds, setTunnelIds] = useState<string[]>(stored.tunnelIds.length ? stored.tunnelIds : activeTunnelIDs)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const next = loadDraft(draftKey)
    setText(next.text); setProjectRefs(next.projectRefs); setMode(next.mode); setIncludeContext(next.includeContext)
    setTunnelIds(next.tunnelIds.length ? next.tunnelIds : activeTunnelIDs); setFiles([])
  }, [draftKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(draftKey, JSON.stringify({ text, projectRefs, mode, includeContext, tunnelIds } satisfies Draft)) } catch { /* best effort */ } }, [draftKey, includeContext, mode, projectRefs, text, tunnelIds])
  useEffect(() => { if (!textarea.current) return; textarea.current.style.height = '0px'; textarea.current.style.height = `${Math.min(220, Math.max(76, textarea.current.scrollHeight))}px` }, [text])

  function addFiles(incoming: File[] | FileList) {
    const next = new Map(files.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file]))
    for (const file of Array.from(incoming)) next.set(`${file.name}:${file.size}:${file.lastModified}`, file)
    setFiles([...next.values()].slice(0, 16))
  }
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) { if (event.clipboardData.files.length) addFiles(event.clipboardData.files) }
  function drop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files) }
  function toggleTunnel(id: string) { setTunnelIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]) }
  async function submit() {
    const message = text.trim()
    if (!message || busy) return
    await onSend({ text: message, files, projectFiles: projectRefs.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean), tunnelIds, mode, includeContext })
    setText(''); setFiles([]); setProjectRefs(''); try { localStorage.removeItem(draftKey) } catch { /* best effort */ }
  }

  const refs = projectRefs.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean)
  return <div className="border-t border-line bg-surface/95 px-3 pb-3 pt-3 backdrop-blur-xl sm:px-6 sm:pb-5">
    <div className="mx-auto max-w-3xl">
      {(files.length > 0 || refs.length > 0 || activeTunnelIDs.length > 0) && <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
        {files.map((file) => <button key={`${file.name}-${file.size}-${file.lastModified}`} onClick={() => setFiles((current) => current.filter((item) => item !== file))} className="rounded-lg border border-line bg-elevated px-2 py-1 text-soft hover:bg-hover" title="Remover anexo">📎 {file.name} ×</button>)}
        {refs.map((path) => <span key={path} className="rounded-lg bg-accent-soft px-2 py-1 text-accent">@ {path}</span>)}
        {activeTunnelIDs.map((id) => <button key={id} onClick={() => toggleTunnel(id)} className={`rounded-lg border px-2 py-1 ${tunnelIds.includes(id) ? 'border-success/30 bg-success/10 text-success' : 'border-line-soft bg-muted text-faint'}`}>↗ {id}</button>)}
      </div>}
      <div onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={drop} className={`rounded-[20px] border bg-elevated p-2 shadow-[0_14px_46px_var(--theme-shadow)] transition ${dragging ? 'border-accent ring-2 ring-accent/15' : 'border-line focus-within:border-accent/60'}`}>
        <textarea ref={textarea} value={text} onPaste={paste} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} rows={3} placeholder="Peça uma alteração, análise ou execução…" className="block max-h-[220px] min-h-[76px] w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-ink outline-none placeholder:text-faint"/>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line-soft px-1 pt-2">
          <input ref={picker} type="file" multiple hidden onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.currentTarget.value = '' }}/>
          <button type="button" onClick={() => picker.current?.click()} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-soft hover:bg-hover" title="Adicionar anexos">＋ Anexo</button>
          <input value={projectRefs} onChange={(event) => setProjectRefs(event.target.value)} placeholder="@ ficheiros" className="w-28 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-soft outline-none placeholder:text-faint focus:ring-1 focus:ring-accent/40 sm:w-36"/>
          <select value={mode} onChange={(event) => setMode(event.target.value as RequestMode)} className="rounded-lg bg-muted px-2 py-1.5 text-xs text-soft outline-none"><option value="direct">Direto</option><option value="plan_first">Plano primeiro</option></select>
          <label className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-faint hover:bg-hover"><input type="checkbox" checked={includeContext} onChange={(event) => setIncludeContext(event.target.checked)}/>Contexto</label>
          <div className="hidden h-5 w-px bg-line sm:block"/>
          <select value={session.effort_level} onChange={(event) => onSessionChange({ ...session, effort_level: event.target.value })} className="rounded-lg bg-muted px-2 py-1.5 text-xs text-soft outline-none" title="Orçamento autónomo"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="extra_high">Extra high</option><option value="max">Max</option></select>
          <select value={session.reasoning_effort} onChange={(event) => onSessionChange({ ...session, reasoning_effort: event.target.value as Session['reasoning_effort'] })} className="rounded-lg bg-muted px-2 py-1.5 text-xs text-soft outline-none" title="Raciocínio"><option value="instant">Instant</option><option value="medium">Medium</option><option value="high">High</option></select>
          <button type="button" disabled={busy || !text.trim()} onClick={() => void submit()} className="ml-auto grid size-9 place-items-center rounded-xl bg-accent text-sm font-black text-accent-ink shadow-sm transition hover:brightness-105 disabled:opacity-35" aria-label={busy ? 'A enviar' : 'Enviar'}>{busy ? '…' : '↑'}</button>
        </div>
      </div>
      <p className="mt-2 px-1 text-center text-[10px] text-faint">Enter envia · Shift+Enter cria linha · o rascunho fica guardado neste dispositivo</p>
    </div>
  </div>
}

function loadDraft(key: string): Draft {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}') as Partial<Draft>
    return { text: String(value.text || ''), projectRefs: String(value.projectRefs || ''), mode: value.mode === 'plan_first' ? 'plan_first' : 'direct', includeContext: value.includeContext !== false, tunnelIds: Array.isArray(value.tunnelIds) ? value.tunnelIds.filter((item): item is string => typeof item === 'string') : [] }
  } catch { return { text: '', projectRefs: '', mode: 'direct', includeContext: true, tunnelIds: [] } }
}
