export function ownsConfirmationFocus(element: Element | null) {
  const dialogs = document.querySelectorAll('[data-wharnex-confirmation][aria-modal="true"]')
  return dialogs.length === 0 || dialogs[dialogs.length - 1] === element
}
