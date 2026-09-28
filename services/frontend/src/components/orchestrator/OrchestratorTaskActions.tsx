import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import type { OrchestratorTask, OrchestratorTaskStatus } from '../../types'

function transitionLabel(status: OrchestratorTaskStatus) {
  if (status === 'ARCHIVED') return 'Arquivar'
  if (status === 'COMPLETE') return 'Concluir'
  return `Mover para ${status}`
}

export function OrchestratorTaskActions({ task, disabled = false, onOpen, onOpenChat, onTransition }: {
  task: OrchestratorTask
  disabled?: boolean
  onOpen: () => void
  onOpenChat?: () => Promise<unknown> | unknown
  onTransition: (status: OrchestratorTaskStatus) => Promise<unknown> | unknown
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const focusEdgeRef = useRef<'first' | 'last'>('first')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const transitions = task.allowed_transitions || []
  const chatAvailable = task.status === 'COMPLETE' || (task.status === 'ARCHIVED' && task.was_completed === true)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', dismiss)
    return () => document.removeEventListener('mousedown', dismiss)
  }, [open])

  useEffect(() => {
    if (!open) return
    const items = rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    const item = focusEdgeRef.current === 'last' ? items?.item((items?.length || 1) - 1) : items?.item(0)
    item?.focus()
  }, [open])

  function stop(event: { stopPropagation: () => void }) { event.stopPropagation() }

  function triggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    event.stopPropagation()
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      focusEdgeRef.current = event.key === 'ArrowUp' ? 'last' : 'first'
    }
  }

  function menuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      rootRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || [])]
    if (!items.length) return
    event.preventDefault()
    event.stopPropagation()
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement))
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length
    items[next]?.focus()
  }


  async function openChat() {
    if (!onOpenChat) return
    setPending(true); setError('')
    try { await onOpenChat(); setOpen(false) }
    catch { setError('Não foi possível abrir o novo chat.') }
    finally { setPending(false) }
  }

  async function transition(status: OrchestratorTaskStatus) {
    setPending(true)
    setError('')
    try {
      await onTransition(status)
      setOpen(false)
    } catch {
      setError('Não foi possível executar a ação.')
    } finally {
      setPending(false)
    }
  }

  return <div ref={rootRef} className="relative ml-auto shrink-0" draggable={false} onClick={stop} onKeyDown={stop} onMouseDown={stop} onPointerDown={stop} onDragStart={(event) => { event.preventDefault(); event.stopPropagation() }}>
    <button type="button" aria-label={`Ações de ${task.title}`} aria-haspopup="menu" aria-expanded={open} disabled={disabled || pending} onClick={() => { setError(''); setOpen((value) => !value) }} onKeyDown={triggerKeyDown} className="grid size-7 place-items-center rounded-md border border-transparent text-lg leading-none text-[var(--theme-text-muted)] outline-none hover:border-[var(--theme-border)] hover:bg-[var(--theme-hover)] focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] disabled:opacity-50"><span aria-hidden="true">⋯</span></button>
    {open && <div role="menu" aria-label={`Ações de ${task.title}`} onKeyDown={menuKeyDown} className="absolute right-0 top-8 z-30 min-w-44 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-elevated)] p-1 shadow-xl">
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onOpen() }} className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-[var(--theme-text)] outline-none hover:bg-[var(--theme-hover)] focus-visible:bg-[var(--theme-hover)]">Abrir detalhe</button>
      {chatAvailable && onOpenChat && <button type="button" role="menuitem" disabled={pending} onClick={() => void openChat()} className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-[var(--theme-text)] outline-none hover:bg-[var(--theme-hover)] focus-visible:bg-[var(--theme-hover)] disabled:opacity-50">Abrir chat</button>}
      {transitions.map((status) => <button key={status} type="button" role="menuitem" disabled={pending} onClick={() => void transition(status)} className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-[var(--theme-text)] outline-none hover:bg-[var(--theme-hover)] focus-visible:bg-[var(--theme-hover)] disabled:opacity-50">{transitionLabel(status)}</button>)}
      {error && <p role="alert" className="m-1 text-xs text-[var(--theme-danger)]">{error}</p>}
    </div>}
  </div>
}
