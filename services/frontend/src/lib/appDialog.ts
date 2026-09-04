export type DialogTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

type DialogBaseOptions = {
  title: string
  message?: string
  tone?: DialogTone
  confirmLabel?: string
  cancelLabel?: string
}

export type ConfirmDialogOptions = DialogBaseOptions
export type NoticeDialogOptions = DialogBaseOptions
export type PromptDialogOptions = DialogBaseOptions & {
  initialValue?: string
  placeholder?: string
  inputLabel?: string
  validate?: (value: string) => string | undefined
}

let dialogQueue: Promise<unknown> = Promise.resolve()
let queuedDialogs = 0
let dialogSequence = 0

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return enqueueDialog(async () => (await openDialog({ ...options, kind: 'confirm' })) === true)
}

export function noticeDialog(options: NoticeDialogOptions): Promise<void> {
  return enqueueDialog(async () => { await openDialog({ ...options, kind: 'notice' }) })
}

export function promptDialog(options: PromptDialogOptions): Promise<string | undefined> {
  return enqueueDialog(async () => {
    const result = await openDialog({ ...options, kind: 'prompt' })
    return typeof result === 'string' ? result : undefined
  })
}

function enqueueDialog<T>(open: () => Promise<T>): Promise<T> {
  queuedDialogs += 1
  let next: Promise<T>
  try {
    next = queuedDialogs === 1 ? open() : dialogQueue.then(open)
  } catch (error) {
    queuedDialogs -= 1
    return Promise.reject(error)
  }
  dialogQueue = next.then(() => undefined, () => undefined)
  void next.then(
    () => { queuedDialogs -= 1 },
    () => { queuedDialogs -= 1 },
  )
  return next
}

type InternalDialogOptions =
  | (ConfirmDialogOptions & { kind: 'confirm' })
  | (NoticeDialogOptions & { kind: 'notice' })
  | (PromptDialogOptions & { kind: 'prompt' })

function openDialog(options: InternalDialogOptions): Promise<boolean | string | undefined> {
  return new Promise((resolve) => {
    const tone = options.tone || 'neutral'
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const backdrop = document.createElement('div')
    backdrop.className = 'app-dialog-backdrop'
    backdrop.dataset.chatgptOverlayBlocker = 'true'

    const card = document.createElement('section')
    card.className = `app-dialog-card tone-${tone}`
    card.setAttribute('role', tone === 'danger' || tone === 'warning' ? 'alertdialog' : 'dialog')
    card.setAttribute('aria-modal', 'true')

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
    let input: HTMLInputElement | undefined
    let error: HTMLSpanElement | undefined

    if (options.kind === 'prompt') {
      const field = document.createElement('label')
      field.className = 'app-dialog-field'
      const label = document.createElement('span')
      label.textContent = options.inputLabel || 'Valor'
      input = document.createElement('input')
      input.type = 'text'
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

    const cleanup = (result: boolean | string | undefined) => {
      document.removeEventListener('keydown', keydown)
      backdrop.remove()
      document.documentElement.classList.remove('app-dialog-open')
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
      cancelButton.textContent = options.cancelLabel || 'Cancelar'
      cancelButton.addEventListener('click', cancel)
      actions.append(cancelButton)
    }

    const confirmButton = document.createElement('button')
    confirmButton.type = 'button'
    confirmButton.className = `app-dialog-button primary tone-${tone}`
    confirmButton.textContent = options.confirmLabel || (options.kind === 'notice' ? 'Entendido' : 'Confirmar')
    confirmButton.addEventListener('click', confirm)
    actions.append(confirmButton)

    content.append(actions)
    card.append(icon, content)
    backdrop.append(card)
    document.body.append(backdrop)
    document.documentElement.classList.add('app-dialog-open')

    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
        return
      }
      if (event.key === 'Enter' && options.kind === 'prompt' && event.target === input) {
        event.preventDefault()
        confirm()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...card.querySelectorAll<HTMLElement>('button,input,[tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute('disabled'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)

    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop && options.kind !== 'notice') cancel()
    })

    const focusInitial = () => {
      if (input) { input.focus(); input.select() }
      else confirmButton.focus()
    }
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focusInitial)
    else window.setTimeout(focusInitial, 0)
  })
}

function toneIcon(tone: DialogTone) {
  if (tone === 'success') return '✓'
  if (tone === 'danger') return '!'
  if (tone === 'warning') return '!'
  if (tone === 'info') return 'i'
  return '•'
}

function toneLabel(tone: DialogTone) {
  if (tone === 'success') return 'Concluído'
  if (tone === 'danger') return 'Ação crítica'
  if (tone === 'warning') return 'Atenção'
  if (tone === 'info') return 'Informação'
  return 'Wharness'
}
