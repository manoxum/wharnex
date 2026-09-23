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

  useEffect(() => {
    const next = loadDraft(draftKey)
    setText(next.text); setProjectRefs(next.projectRefs); setMode(next.mode); setIncludeContext(next.includeContext)
    setTunnelIds(next.tunnelIds.length ? next.tunnelIds : activeTunnelIDs)
    setFiles([])
  }, [draftKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(draftKey, JSON.stringify({ text, projectRefs, mode, includeContext, tunnelIds } satisfies Draft)) } catch { /* best effort */ } }, [draftKey, includeContext, mode, projectRefs, text, tunnelIds])

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
    setText(''); setFiles([]); setProjectRefs('')
    try { localStorage.removeItem(draftKey) } catch { /* best effort */ }
  }

  return <div className="border-t border-slate-800 bg-slate-950/90 p-3 sm:p-4">
    {(files.length > 0 || projectRefs.trim() || activeTunnelIDs.length > 0) && <div className="mb-2 flex flex-wrap gap-2 text-xs">
      {files.map((file) => <button key={`${file.name}-${file.size}-${file.lastModified}`} onClick={() => setFiles((current) => current.filter((item) => item !== file))} className="rounded-lg bg-slate-800 px-2 py-1 text-slate-300" title="Remover anexo">📎 {file.name} ×</button>)}
      {projectRefs.split(/[\n,]+/).filter(Boolean).map((path) => <span key={path} className="rounded-lg bg-cyan-950 px-2 py-1 text-cyan-300">@ {path.trim()}</span>)}
      {activeTunnelIDs.map((id) => <button key={id} onClick={() => toggleTunnel(id)} className={`rounded-lg px-2 py-1 ${tunnelIds.includes(id) ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-900 text-slate-600'}`}>↗ {id}</button>)}
    </div>}
    <div onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={drop} className={`rounded-2xl border bg-slate-900 p-2 transition ${dragging ? 'border-cyan-400 ring-2 ring-cyan-400/20' : 'border-slate-700 focus-within:border-cyan-500'}`}>
      <textarea value={text} onPaste={paste} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} rows={3} placeholder="Descreva o que quer que o Agent faça… Pode colar ou arrastar ficheiros." className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-slate-600" />
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
        <input ref={picker} type="file" multiple hidden onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.currentTarget.value = '' }}/>
        <button type="button" onClick={() => picker.current?.click()} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:bg-slate-800">📎 Anexos</button>
        <input value={projectRefs} onChange={(event) => setProjectRefs(event.target.value)} placeholder="@ ficheiros do projeto" className="min-w-40 flex-1 rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs outline-none placeholder:text-slate-600" />
        <select value={mode} onChange={(event) => setMode(event.target.value as RequestMode)} className="rounded-lg bg-slate-800 px-2 py-1.5 text-xs"><option value="direct">Direto</option><option value="plan_first">Plano primeiro</option></select>
        <label className="flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" checked={includeContext} onChange={(event) => setIncludeContext(event.target.checked)}/>Contexto</label>
        <select value={session.effort_level} onChange={(event) => onSessionChange({ ...session, effort_level: event.target.value })} className="rounded-lg bg-slate-800 px-2 py-1.5 text-xs" title="Orçamento autónomo"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="extra_high">Extra high</option><option value="max">Max</option></select>
        <select value={session.reasoning_effort} onChange={(event) => onSessionChange({ ...session, reasoning_effort: event.target.value as Session['reasoning_effort'] })} className="rounded-lg bg-slate-800 px-2 py-1.5 text-xs" title="Raciocínio"><option value="instant">Instant</option><option value="medium">Medium</option><option value="high">High</option></select>
        <button type="button" disabled={busy || !text.trim()} onClick={() => void submit()} className="ml-auto rounded-xl bg-cyan-400 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-40">{busy ? 'A enviar…' : 'Enviar'}</button>
      </div>
    </div>
    <p className="mt-2 text-[10px] text-slate-600">Enter envia · Shift+Enter cria linha · rascunho guardado localmente · processamento do navegador fica no Desktop.</p>
  </div>
}

function loadDraft(key: string): Draft {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}') as Partial<Draft>
    return { text: String(value.text || ''), projectRefs: String(value.projectRefs || ''), mode: value.mode === 'plan_first' ? 'plan_first' : 'direct', includeContext: value.includeContext !== false, tunnelIds: Array.isArray(value.tunnelIds) ? value.tunnelIds.filter((item): item is string => typeof item === 'string') : [] }
  } catch { return { text: '', projectRefs: '', mode: 'direct', includeContext: true, tunnelIds: [] } }
}
