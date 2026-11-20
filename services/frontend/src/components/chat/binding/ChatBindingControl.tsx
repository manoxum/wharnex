import { translate as uiText, formatMessage } from '../../../lib/workspace/localization'
import { useEffect, useRef, useState } from 'react'
import { ChatBindingRecovery } from './ChatBindingRecovery'
import { Icon } from '../../presentation/chrome/Icon'

export function ChatBindingControl({ chatId, linkedUrl, mismatch = false, onBind }: {
  chatId: string
  linkedUrl?: string
  mismatch?: boolean
  onBind: (url: string) => boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const linked = Boolean(linkedUrl)
  const stateLabel = mismatch ? 'outra conversa' : linked ? 'vinculado' : 'a vincular'
  const icon = mismatch ? 'alert' : linked ? 'check' : 'link'
  const tone = mismatch
    ? 'border-whx-warning/40 bg-whx-warning/10 text-whx-warning hover:bg-whx-warning/15'
    : linked
      ? 'border-whx-success/40 bg-whx-success/10 text-whx-success hover:bg-whx-success/15'
      : 'border-whx-border bg-whx-muted text-whx-faint hover:bg-whx-hover hover:text-whx-soft'

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return <span ref={rootRef} className="relative inline-flex">
    <button
      type="button"
      className={`grid size-7 place-items-center rounded-md border transition ${tone}`}
      aria-label={formatMessage('Vínculo ChatGPT: {state}', { state: uiText(stateLabel) })}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={formatMessage('Vínculo ChatGPT: {state}', { state: uiText(stateLabel) })}
      onClick={() => setOpen((value) => !value)}
    >
      <Icon name={icon} size={15}/>
    </button>
    {open && <div
      className="absolute right-0 top-[calc(100%+7px)] z-[70] w-[min(620px,calc(100vw-24px))]"
      role="dialog"
      aria-label={uiText("Vínculo da conversa ChatGPT")}
    >
      <ChatBindingRecovery chatId={chatId} linkedUrl={linkedUrl} onBind={onBind} onLinked={() => setOpen(false)}/>
    </div>}
  </span>
}
