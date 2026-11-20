import { translate } from '../../workspace/localization'
import { openDialog } from './dialogs/dialogSurface'

export type DialogTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

type DialogBaseOptions = {
  title: string
  message?: string
  tone?: DialogTone
  confirmLabel?: string
  cancelLabel?: string
  discardLabel?: string
}

export type ConfirmDialogOptions = DialogBaseOptions
export type NoticeDialogOptions = DialogBaseOptions
export type PromptDialogOptions = DialogBaseOptions & {
  initialValue?: string
  placeholder?: string
  inputLabel?: string
  multiline?: boolean
  validate?: (value: string) => string | undefined
}

let dialogQueue: Promise<unknown> = Promise.resolve()
let queuedDialogs = 0

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return enqueueDialog(async () => (await openDialog({ ...options, kind: 'confirm' })) === true)
}

export function saveChangesDialog(options: ConfirmDialogOptions): Promise<'save' | 'discard' | 'cancel'> {
  return enqueueDialog(async () => { const result = await openDialog({ ...options, kind: 'confirm', discardLabel: options.discardLabel || translate('Não guardar') }); return result === true ? 'save' : result === 'discard' ? 'discard' : 'cancel' })
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
