import { translate as uiText, formatMessage } from '../../../../lib/workspace/localization'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { desktopBridge } from '../../../../lib/desktop/bridge/desktop'
import { errorMessage } from '../../../../lib/workspace/dialogs'
import { Icon } from '../../../presentation/chrome/Icon'
import { choiceChrome } from './ComposerSelectChoice'
import { modelPopoverPlacement, type ModelPopoverPlacement } from './modelPopoverPlacement'

type Props = { workspaceChatId: string; url?: string; disabled?: boolean }

export function ComposerModelControl({ workspaceChatId, url, disabled = false }: Props) {
  return <OwnedModelControl key={`${workspaceChatId}:${url || ''}`} workspaceChatId={workspaceChatId} url={url} disabled={disabled} />
}

function OwnedModelControl({ workspaceChatId, url, disabled }: Props) {
  const [inventory, setInventory] = useState<DesktopChatGPTModels>()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [discoveryReady, setDiscoveryReady] = useState(false)
  const [placement, setPlacement] = useState<ModelPopoverPlacement>({ className: 'bottom-full left-0 mb-1', minWidth: 192, maxWidth: 288, maxHeight: 256 })
  const revision = useRef(0)
  const shell = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const keyboardFocus = useRef<'first' | 'last' | undefined>(undefined)
  const listId = useId()
  const bridge = desktopBridge()?.chatgpt
  const available = Boolean(workspaceChatId && bridge?.getChatGPTModels && bridge?.setChatGPTModel)
  const current = inventory?.options.find((option) => option.id === inventory.current)?.label || inventory?.current || uiText('Modelo')

  useEffect(() => () => { revision.current += 1 }, [])
  useEffect(() => {
    if (!open || !discoveryReady || !keyboardFocus.current) return
    const choices = shell.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')
    choices?.[keyboardFocus.current === 'first' ? 0 : choices.length - 1]?.focus()
    keyboardFocus.current = undefined
  }, [open, discoveryReady])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !shell.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  useEffect(() => {
    if (!open) return
    const updatePlacement = () => {
      const bounds = trigger.current?.getBoundingClientRect()
      if (!bounds) return
      const next = modelPopoverPlacement(bounds, { width: window.innerWidth, height: window.innerHeight })
      setPlacement((current) => current.className === next.className && current.minWidth === next.minWidth && current.maxWidth === next.maxWidth && current.maxHeight === next.maxHeight ? current : next)
    }
    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [open])

  async function refresh() {
    if (!available || disabled || pending) return
    if (open) { setOpen(false); return }
    const generation = ++revision.current
    setOpen(true)
    setPending(true)
    setError('')
    setDiscoveryReady(false)
    try {
      const result = await bridge!.getChatGPTModels({ workspaceChatId, ...(url ? { url } : {}) })
      if (revision.current !== generation) return
      if (!result.ok || !result.options.length) throw new Error(result.detail || uiText('O ChatGPT não disponibilizou os modelos deste chat.'))
      setInventory(result)
      setDiscoveryReady(true)
    } catch (cause) {
      if (revision.current === generation) setError(errorMessage(cause, uiText('Não foi possível consultar os modelos do chat.')))
    } finally {
      if (revision.current === generation) setPending(false)
    }
  }

  async function choose(model: string) {
    if (disabled || pending || !discoveryReady || !inventory?.options.some((option) => option.id === model && !option.disabled)) return
    const generation = ++revision.current
    setPending(true)
    setError('')
    try {
      const result = await bridge!.setChatGPTModel({ workspaceChatId, ...(url ? { url } : {}), model })
      if (revision.current !== generation) return
      if (!result.ok || result.current !== model) throw new Error(result.detail || uiText('O ChatGPT não confirmou a mudança de modelo.'))
      setInventory(result)
      setOpen(false)
      trigger.current?.focus()
    } catch (cause) {
      if (revision.current === generation) setError(errorMessage(cause, uiText('Não foi possível escolher o modelo.')))
    } finally {
      if (revision.current === generation) setPending(false)
    }
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); keyboardFocus.current = undefined; setOpen(false); trigger.current?.focus(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      keyboardFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'
      void refresh()
      return
    }
    const choices = Array.from(shell.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') || [])
    if (!choices.length) return
    event.preventDefault()
    const index = choices.indexOf(document.activeElement as HTMLButtonElement)
    let next = event.key === 'Home' ? 0 : choices.length - 1
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      next = index < 0 ? (event.key === 'ArrowDown' ? 0 : choices.length - 1)
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length
    }
    choices[next].focus()
  }

  return <div ref={shell} className="relative inline-flex shrink-0" onKeyDown={navigate}>
    <button ref={trigger} type="button" aria-label={uiText("Modelo do ChatGPT")} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      title={!available ? uiText("Escolha de modelo disponível no Desktop para um chat vinculado") : disabled ? uiText("Modelo bloqueado durante a request ou no transporte manual") : formatMessage('Modelo do ChatGPT · {model}', { model: current })}
      disabled={disabled || !available || pending} onClick={() => void refresh()}
      className={`${choiceChrome} !h-8 !min-h-8 cursor-pointer! py-0! font-sans text-[calc(10.5px*var(--ui-font-scale))]! font-semibold! disabled:cursor-default! disabled:opacity-50`}>
      <Icon name={pending ? 'refresh' : 'chatgpt'} size={13} /><span className="max-w-[16ch] truncate">{current}</span><Icon name="chevron" size={10} />
    </button>
    {open && <div id={listId} style={{ minWidth: placement.minWidth, maxWidth: placement.maxWidth, maxHeight: placement.maxHeight }} className={`absolute ${placement.className} z-50 w-max overflow-y-auto rounded-[var(--radius-popover)] border border-whx-border bg-whx-elevated p-1.5 text-sm text-whx-text shadow-lg`}>
      {pending ? <p role="status" className="m-0! p-1.5">{uiText("A consultar o ChatGPT…")}</p> : null}
      {error ? <p role="alert" className="m-0! p-1.5 text-whx-warning">{error}</p> : null}
      {inventory && discoveryReady && <div role="listbox" aria-label={uiText("Modelos disponíveis neste chat")} aria-busy={pending} className="max-h-64 overflow-y-auto">
        {inventory.options.map((option) => <button key={option.id} type="button" role="option" aria-selected={option.id === inventory.current}
          tabIndex={option.id === inventory.current ? 0 : -1}
          disabled={disabled || pending || option.disabled} onClick={() => void choose(option.id)}
          className="flex! min-h-7! w-full! items-center! justify-between! gap-2! rounded-[var(--radius-control)]! border-0! bg-transparent! px-2! py-1! text-left! text-sm! text-whx-text! hover:bg-whx-hover! focus-visible:bg-whx-hover! disabled:opacity-50 aria-selected:bg-whx-accent-soft!">
          <span>{option.label}</span>{option.id === inventory.current ? <Icon name="check" size={12} /> : null}
        </button>)}
      </div>}
      {!pending && error ? <button type="button" className="mt-1! min-h-6! border-whx-border! bg-whx-muted! px-2! py-1! text-sm! text-whx-soft!" onClick={() => { setOpen(false) }}>{uiText("Fechar e tentar novamente")}</button> : null}
    </div>}
  </div>
}
