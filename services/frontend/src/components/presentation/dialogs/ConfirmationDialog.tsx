import { useTranslation } from '../../../lib/workspace/localization'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { ownsConfirmationFocus } from '../../../lib/desktop/bridge/dialogs/focusBoundary'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from '../chrome/Icon'
import { Button } from '../workbench'
export type ConfirmationAction = { label: string; description?: string; icon?: IconName; tone?: 'neutral' | 'primary' | 'danger'; run: () => void }
export function ConfirmationDialog({ title, description, icon = 'info', busy = false, error, actions, children, onCancel, initialAction = 0 }: {
  title: string; description: string; icon?: IconName; busy?: boolean; error?: string; actions: ConfirmationAction[]; children?: ReactNode; onCancel: () => void; initialAction?: number
}) {
  const t = useTranslation()
  const root = useRef<HTMLElement>(null)
  const id = useId()
  const cancel = useRef(onCancel); cancel.current = onCancel
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const target = root.current?.querySelectorAll<HTMLButtonElement>('[data-confirmation-action]')[initialAction]
    if (target && !target.disabled) target.focus(); else root.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [initialAction])
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!ownsConfirmationFocus(root.current)) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) cancel.current() }
      if (event.key === 'Tab') {
        const buttons = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,[tabindex="0"]') || [])]
        const current = buttons.indexOf(document.activeElement as HTMLElement)
        event.preventDefault(); buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
      }
    }
    document.addEventListener('keydown', keyboard, true)
    return () => document.removeEventListener('keydown', keyboard, true)
  }, [busy])
  const choices = actions.some((action) => action.description)
  return createPortal(<div className="fixed inset-0 z-[10060] grid place-items-center bg-[var(--theme-overlay)] p-4 backdrop-blur-sm" data-confirmation-overlay>
    <section ref={root} data-wharnex-confirmation tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} className="grid max-h-[calc(100vh-32px)] w-[min(420px,calc(100vw-32px))] gap-3 overflow-y-auto rounded-lg border border-whx-border bg-whx-surface p-5 text-whx-label text-whx-text shadow-[0_16px_48px_var(--theme-shadow)]">
      <header className="flex items-center gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-md bg-whx-muted text-whx-faint"><Icon name={icon} size={18}/></span><h2 id={`${id}-title`} className="!m-0 !text-[calc(15px*var(--ui-font-scale))] !font-semibold !leading-snug !text-whx-text">{title}</h2></header>
      <p id={`${id}-description`} className="!m-0 !text-whx-label !leading-relaxed !text-whx-soft">{description}</p>
      {children}
      {error && <p role="status" className="!m-0 flex items-start gap-2 !text-whx-label !text-whx-danger"><Icon name="alert" size={14}/>{error}</p>}
      <div className={choices ? 'grid gap-1' : 'mt-2 flex flex-wrap justify-end gap-2'}>
        {actions.map((action) => choices ? <button key={action.label} type="button" data-confirmation-action aria-label={action.label} title={action.description} disabled={busy} onClick={action.run} className={`flex min-h-10 items-center gap-2 rounded-md border-0 bg-transparent px-2 py-2 text-left hover:bg-whx-hover focus-visible:outline-2 focus-visible:outline-whx-accent disabled:opacity-40 ${action.tone === 'danger' ? 'text-whx-danger' : 'text-whx-text'}`}>
          {action.icon && <Icon name={action.icon} size={16}/>}<span className="grid gap-1"><strong className="text-whx-label font-medium">{action.label}</strong>{action.description && <small className="text-whx-caption leading-relaxed text-whx-faint">{action.description}</small>}</span>
        </button> : <Button key={action.label} data-confirmation-action tone={action.tone} icon={busy && action.tone === 'primary' ? 'refresh' : action.icon} disabled={busy} onClick={action.run}>{action.label}</Button>)}
      </div>
      {choices && <div className="flex justify-end border-t border-whx-border-soft pt-2"><Button disabled={busy} onClick={onCancel}>{t('Cancelar')}</Button></div>}
    </section>
  </div>, document.body)
}
