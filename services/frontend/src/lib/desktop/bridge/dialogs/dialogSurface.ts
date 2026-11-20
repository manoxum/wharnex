import { translate } from '../../../workspace/localization'
import { bindInternalWindowDrag, bindInternalWindowResize } from '../../../workspace/layout/internalWindow'
import { ownsConfirmationFocus } from './focusBoundary'
import { dialogWindowControls } from './dialogWindowControls'
import { styleDialog, toneIcon, toneLabel } from './dialogStyle'
import type { ConfirmDialogOptions, NoticeDialogOptions, PromptDialogOptions } from '../appDialog'
let dialogSequence = 0
type InternalDialogOptions =
  | (ConfirmDialogOptions & { kind: 'confirm' })
  | (NoticeDialogOptions & { kind: 'notice' })
  | (PromptDialogOptions & { kind: 'prompt' })

export function openDialog(options: InternalDialogOptions): Promise<boolean | string | undefined> {
  return new Promise((resolve) => {
    const tone = options.tone || 'neutral'
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const backdrop = document.createElement('div')
    backdrop.className = 'app-dialog-backdrop internal-window-layer'
    backdrop.dataset.internalWindowState = 'open'

    const shell = document.createElement('div')
    shell.className = 'internal-window-shell'

    const card = document.createElement('section')
    card.className = `app-dialog-card tone-${tone}`
    card.setAttribute('role', tone === 'danger' || tone === 'warning' ? 'alertdialog' : 'dialog')
    card.setAttribute('aria-modal', 'true')
    card.dataset.wharnexConfirmation = 'true'

    dialogSequence += 1
    const titleId = `app-dialog-title-${dialogSequence}`
    card.setAttribute('aria-labelledby', titleId)

    const icon = document.createElement('div')
    icon.className = 'app-dialog-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.textContent = toneIcon(tone)

    const content = document.createElement('div')
    content.className = 'app-dialog-content'

    const eyebrow = document.createElement('span')
    eyebrow.className = 'app-dialog-eyebrow'
    eyebrow.textContent = toneLabel(tone)

    const title = document.createElement('h2')
    title.id = titleId
    title.textContent = options.title

    content.append(eyebrow, title)

    if (options.message) {
      const message = document.createElement('p')
      message.className = 'app-dialog-message'
      message.textContent = options.message
      content.append(message)
    }

    const body = document.createElement('div')
    body.className = 'app-dialog-body'
    let input: HTMLInputElement | HTMLTextAreaElement | undefined
    let error: HTMLSpanElement | undefined

    if (options.kind === 'prompt') {
      const field = document.createElement('label')
      field.className = 'app-dialog-field'
      const label = document.createElement('span')
      label.textContent = options.inputLabel || translate('Valor')
      input = options.multiline ? document.createElement('textarea') : document.createElement('input')
      if (input instanceof HTMLInputElement) input.type = 'text'
      if (input instanceof HTMLTextAreaElement) input.rows = 5
      input.value = options.initialValue || ''
      input.placeholder = options.placeholder || ''
      input.autocomplete = 'off'
      input.spellcheck = false
      error = document.createElement('span')
      error.className = 'app-dialog-field-error'
      error.setAttribute('role', 'status')
      input.addEventListener('input', () => { if (error) error.textContent = '' })
      field.append(label, input, error)
      body.append(field)
      content.append(body)
    }

    const actions = document.createElement('div')
    actions.className = 'app-dialog-actions'
    let detachDrag: () => void = () => {}
    let detachResize: () => void = () => {}

    let settled = false
    const cleanup = (result: boolean | string | undefined) => {
      if (settled) return
      settled = true
      document.removeEventListener('keydown', keydown)
      detachResize()
      detachDrag()
      windowControls.cleanup()
      backdrop.remove()
      previousFocus?.focus()
      resolve(result)
    }

    const cancel = () => cleanup(options.kind === 'confirm' ? false : undefined)
    const confirm = () => {
      if (options.kind === 'prompt') {
        const value = input?.value.trim() || ''
        const validation = options.validate?.(value)
        if (validation) {
          if (error) error.textContent = validation
          input?.focus()
          return
        }
        cleanup(value)
        return
      }
      cleanup(options.kind === 'notice' ? undefined : true)
    }

    if (options.kind !== 'notice') {
      const cancelButton = document.createElement('button')
      cancelButton.type = 'button'
      cancelButton.className = 'app-dialog-button secondary'
      cancelButton.textContent = options.cancelLabel || translate('Cancelar')
      cancelButton.addEventListener('click', cancel)
      actions.append(cancelButton)
    }

    if (options.discardLabel) {
      const discard = document.createElement('button'); discard.type = 'button'; discard.className = 'app-dialog-button secondary'; discard.textContent = options.discardLabel; discard.addEventListener('click', () => cleanup('discard')); actions.append(discard)
    }

    const confirmButton = document.createElement('button')
    confirmButton.type = 'button'
    confirmButton.className = `app-dialog-button primary tone-${tone}`
    confirmButton.textContent = options.confirmLabel || (translate(options.kind === 'notice' ? 'Entendido' : 'Confirmar'))
    confirmButton.addEventListener('click', confirm)
    actions.append(confirmButton)

    const windowControls = dialogWindowControls(options, backdrop, cancel)
    const { controls, dragGrip, resizeGrip } = windowControls
    content.append(actions)
    card.append(icon, content)
    shell.append(card, controls, resizeGrip)
    detachDrag = bindInternalWindowDrag(shell, [dragGrip])
    detachResize = bindInternalWindowResize(shell, resizeGrip)
    backdrop.append(shell)
    styleDialog(backdrop)
    document.body.append(backdrop)

    const keydown = (event: KeyboardEvent) => {
      if (!ownsConfirmationFocus(card)) return
      if (event.key === 'Tab' && !backdrop.classList.contains('is-minimized')) {
        const elements = [...shell.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea')]; const index = elements.indexOf(document.activeElement as HTMLElement)
        event.preventDefault(); elements[(index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length]?.focus()
      }
      if (event.key === 'Escape' && !backdrop.classList.contains('is-minimized')) {
        event.preventDefault()
        cancel()
        return
      }
      if (event.key === 'Enter' && options.kind === 'prompt' && event.target === input) {
        if (input instanceof HTMLTextAreaElement && !event.ctrlKey && !event.metaKey) return
        event.preventDefault()
        confirm()
      }
    }
    document.addEventListener('keydown', keydown)

    const focusInitial = () => {
      if (settled || !ownsConfirmationFocus(card)) return
      if (input) { input.focus(); input.select() }
      else if (tone === 'danger' || tone === 'warning') actions.querySelector<HTMLButtonElement>('button')?.focus()
      else confirmButton.focus()
    }
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focusInitial)
    else window.setTimeout(focusInitial, 0)
  })
}
