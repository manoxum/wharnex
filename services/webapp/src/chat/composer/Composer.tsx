import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { makeDirective, parseDirectives, removeDirective, type DirectiveKind } from './composerDirectives'
import type { AppConfig, PanelName, RequestMode, Session } from '../../transport/contracts'
import { ComposerTray } from './ComposerTray'

export type ComposerValue = { text: string; files: File[]; projectFiles: string[]; tunnelIds: string[]; mode: RequestMode; includeContext: boolean }
type Draft = { text: string; mode: RequestMode; includeContext: boolean; tunnelIds: string[] }

export function Composer({ session, config, busy, onSend, onSessionChange, onOpenPanel }: {
  session: Session; config?: AppConfig; busy: boolean; onSend: (value: ComposerValue) => Promise<void>; onSessionChange: (session: Session) => void
  onOpenPanel?: (panel: PanelName) => void
}) {
  const draftKey = `wharnex.remote.composer:${session.id}`
  const stored = useMemo(() => loadDraft(draftKey), [draftKey])
  const activeTunnelIDs = useMemo(() => (config?.remote_input?.instances || []).filter((item) => item.available && (item.state || 'active') === 'active').map((item) => item.id), [config])
  const [text, setText] = useState(stored.text); const [files, setFiles] = useState<File[]>([])
  const [mode, setMode] = useState<RequestMode>(stored.mode); const [includeContext, setIncludeContext] = useState(stored.includeContext)
  const [tunnelIds, setTunnelIds] = useState<string[]>(stored.tunnelIds.length ? stored.tunnelIds : activeTunnelIDs)
  const [trayOpen, setTrayOpen] = useState(false); const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null); const textarea = useRef<HTMLTextAreaElement>(null)
  const chips = useMemo(() => parseDirectives(text), [text])

  useEffect(() => { const next = loadDraft(draftKey); setText(next.text); setMode(next.mode); setIncludeContext(next.includeContext); setTunnelIds(next.tunnelIds.length ? next.tunnelIds : activeTunnelIDs); setFiles([]) }, [draftKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(draftKey, JSON.stringify({ text, mode, includeContext, tunnelIds } satisfies Draft)) } catch { /* best effort */ } }, [draftKey, includeContext, mode, text, tunnelIds])
  useEffect(() => { if (!textarea.current) return; textarea.current.style.height = '0px'; textarea.current.style.height = `${Math.min(220, Math.max(68, textarea.current.scrollHeight))}px` }, [text])

  function addFiles(incoming: File[] | FileList) { const next = new Map(files.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file])); for (const file of Array.from(incoming)) next.set(`${file.name}:${file.size}:${file.lastModified}`, file); setFiles([...next.values()].slice(0, 16)) }
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) { if (event.clipboardData.files.length) addFiles(event.clipboardData.files) }
  function drop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files) }
  function toggleTunnel(id: string) { setTunnelIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]) }
  function insertDirective(kind: DirectiveKind) {
    const input = textarea.current; const marker = makeDirective(kind, '')
    const start = input?.selectionStart ?? text.length; const end = input?.selectionEnd ?? text.length
    const spacer = start > 0 && !/\s/.test(text[start - 1] || '') ? ' ' : ''
    const next = `${text.slice(0, start)}${spacer}${marker}${text.slice(end)}`; setText(next); setTrayOpen(false)
    requestAnimationFrame(() => { const position = start + spacer.length + marker.length - 1; input?.focus(); input?.setSelectionRange(position, position) })
  }
  async function submit() { const message = text.trim(); if (!message || busy) return; await onSend({ text: message, files, projectFiles: [], tunnelIds, mode, includeContext }); setText(''); setFiles([]); setTrayOpen(false); try { localStorage.removeItem(draftKey) } catch { /* best effort */ } }

  return <div className="border-t border-line bg-surface/95 px-3 pb-3 pt-3 backdrop-blur-xl sm:px-6 sm:pb-5">
    <div className="mx-auto max-w-3xl">
      {(files.length > 0 || chips.length > 0 || activeTunnelIDs.length > 0) && <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
        {files.map((file) => <button key={`${file.name}-${file.size}-${file.lastModified}`} onClick={() => setFiles((current) => current.filter((item) => item !== file))} className="rounded-lg border border-line bg-elevated px-2 py-1 text-soft hover:bg-hover">📎 {file.name} ×</button>)}
        {chips.map((chip) => <button key={`${chip.start}-${chip.raw}`} onClick={() => setText((value) => removeDirective(value, chip))} className="rounded-lg border border-accent/20 bg-accent-soft px-2 py-1 font-semibold text-accent" title="Remover directiva">{chip.kind} · {chip.value || '…'} ×</button>)}
        {activeTunnelIDs.map((id) => <button key={id} onClick={() => toggleTunnel(id)} className={`rounded-lg border px-2 py-1 ${tunnelIds.includes(id) ? 'border-success/30 bg-success/10 text-success' : 'border-line-soft bg-muted text-faint'}`}>↗ {id}</button>)}
      </div>}
      <div onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={drop} className={`rounded-[22px] border bg-elevated p-2 shadow-[0_14px_46px_var(--theme-shadow)] transition ${dragging ? 'border-accent ring-2 ring-accent/15' : 'border-line focus-within:border-accent/60'}`}>
        <textarea ref={textarea} value={text} onPaste={paste} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} rows={3} placeholder="Peça uma alteração, análise ou execução…" className="block max-h-[220px] min-h-[68px] w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-ink outline-none placeholder:text-faint"/>
        <div className="flex items-center gap-2 border-t border-line-soft px-1 pt-2">
          <input ref={picker} type="file" multiple hidden onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.currentTarget.value = '' }}/>
          <button type="button" onClick={() => setTrayOpen((value) => !value)} className={`grid size-9 place-items-center rounded-xl border text-lg transition ${trayOpen ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-surface text-soft hover:bg-hover'}`} aria-label="Ferramentas do composer" aria-expanded={trayOpen}>＋</button>
          <p className="min-w-0 flex-1 truncate text-[11px] text-faint">{mode === 'plan_first' ? 'Plano primeiro' : 'Direto'} · {session.effort_level} · {includeContext ? 'contexto' : 'sem contexto'}</p>
          <button type="button" disabled={busy || !text.trim()} onClick={() => void submit()} className="grid size-10 place-items-center rounded-xl bg-accent text-sm font-black text-accent-ink shadow-sm transition hover:brightness-105 disabled:opacity-35" aria-label={busy ? 'A enviar' : 'Enviar'}>{busy ? '…' : '↑'}</button>
        </div>
      </div>
      {trayOpen && <ComposerTray session={session} config={config} mode={mode} includeContext={includeContext} tunnelIds={tunnelIds} onMode={setMode} onContext={setIncludeContext} onTunnel={toggleTunnel} onAttach={() => picker.current?.click()} onDirective={insertDirective} onSessionChange={onSessionChange} onOpenPanel={onOpenPanel}/>}
      <p className="mt-2 px-1 text-center text-[10px] text-faint">Enter envia · Shift+Enter cria linha · ＋ abre ferramentas e directivas</p>
    </div>
  </div>
}

function loadDraft(key: string): Draft {
  try { const value = JSON.parse(localStorage.getItem(key) || '{}') as Partial<Draft>; return { text: String(value.text || ''), mode: value.mode === 'plan_first' ? 'plan_first' : 'direct', includeContext: value.includeContext !== false, tunnelIds: Array.isArray(value.tunnelIds) ? value.tunnelIds.filter((item): item is string => typeof item === 'string') : [] } }
  catch { return { text: '', mode: 'direct', includeContext: true, tunnelIds: [] } }
}
