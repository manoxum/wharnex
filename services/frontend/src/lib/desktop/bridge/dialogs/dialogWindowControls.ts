import { ensureInternalWindowDockRoot } from '../../../workspace/layout/internalWindow'

export function dialogWindowControls(options: { title: string }, backdrop: HTMLDivElement, cancel: () => void) {
  let dockItem: HTMLDivElement | undefined
  const dockRoot = ensureInternalWindowDockRoot()
  const controls = document.createElement('div')
  controls.className = 'internal-window-controls'
  controls.setAttribute('role', 'group')
  controls.setAttribute('aria-label', `Controlos da janela ${options.title}`)

  const dragGrip = document.createElement('span')
  dragGrip.className = 'internal-window-drag-grip'
  dragGrip.dataset.internalWindowDragHandle = 'true'
  dragGrip.setAttribute('aria-hidden', 'true')

  const minimizeButton = document.createElement('button')
  minimizeButton.type = 'button'
  minimizeButton.textContent = '−'
  minimizeButton.title = 'Minimizar'
  minimizeButton.setAttribute('aria-label', `Minimizar ${options.title}`)

  const resizeGrip = document.createElement('span')
  resizeGrip.className = 'internal-window-resize-grip'
  resizeGrip.dataset.internalWindowNoDrag = 'true'
  resizeGrip.setAttribute('role', 'separator')
  resizeGrip.setAttribute('aria-label', `Redimensionar ${options.title}`)

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.textContent = '×'
  closeButton.title = 'Fechar'
  closeButton.setAttribute('aria-label', `Fechar ${options.title}`)
  closeButton.addEventListener('click', cancel)

  minimizeButton.addEventListener('click', () => {
    backdrop.querySelector('[aria-modal]')?.setAttribute('aria-modal', 'false')
    backdrop.classList.add('is-minimized')
    backdrop.dataset.internalWindowState = 'minimized'
    backdrop.setAttribute('aria-hidden', 'true')
    if (!dockRoot || dockItem) return
    dockItem = document.createElement('div')
    dockItem.className = 'internal-window-dock-item'
    dockItem.dataset.internalWindowState = 'minimized'
    const restoreButton = document.createElement('button')
    restoreButton.type = 'button'
    restoreButton.className = 'internal-window-dock-restore'
    restoreButton.title = `Restaurar ${options.title}`
    restoreButton.innerHTML = '<span aria-hidden="true">▣</span>'
    const dockTitle = document.createElement('strong')
    dockTitle.textContent = options.title
    restoreButton.append(dockTitle)
    restoreButton.addEventListener('click', () => {
    dockItem?.remove()
    dockItem = undefined
    backdrop.classList.remove('is-minimized')
    backdrop.dataset.internalWindowState = 'open'
    backdrop.removeAttribute('aria-hidden')
    })
    const dockClose = document.createElement('button')
    dockClose.type = 'button'
    dockClose.className = 'internal-window-dock-close'
    dockClose.textContent = '×'
    dockClose.title = 'Fechar'
    dockClose.setAttribute('aria-label', `Fechar ${options.title}`)
    dockClose.addEventListener('click', cancel)
    dockItem.append(restoreButton, dockClose)
    dockRoot.append(dockItem)
  })

  controls.append(dragGrip, minimizeButton, closeButton)
  return { controls, dragGrip, resizeGrip, cleanup: () => dockItem?.remove() }
}
