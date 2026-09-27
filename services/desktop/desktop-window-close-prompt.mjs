// Native escape hatch for the themed close confirmation. The renderer owns the
// normal decision; this prompt runs only when that renderer never answered, so
// it must depend on nothing but Electron's own synchronous dialog.
const RESPONSE_ACTIONS = ['background', 'close-window', 'close-all', 'cancel']

export function nativeWindowCloseOptions(descriptor) {
  const subject = descriptor.hasProject ? descriptor.projectName : ''
  return {
    type: 'question',
    title: subject ? `Fechar ${subject}` : 'Fechar janela do Wharnex',
    message: subject ? `O que pretende fazer com o projeto ${subject}?` : 'O que pretende fazer com esta janela?',
    detail: 'Enviar para background mantém o Wharnex ativo no ícone da área de notificação. Sair guarda a sessão recuperável antes de encerrar.',
    buttons: ['Enviar para background', 'Fechar esta janela', 'Fechar todos os projetos', 'Abortar operação'],
    defaultId: 0,
    cancelId: 3,
    noLink: true,
  }
}

export function nativeWindowCloseChoice(dialog, window, descriptor) {
  try {
    const response = dialog.showMessageBoxSync(window, nativeWindowCloseOptions(descriptor))
    return RESPONSE_ACTIONS[response] || 'cancel'
  } catch (error) {
    // Both the renderer and the native dialog are unavailable. Refusing the
    // close here is the one outcome with no way out, so release the window.
    console.error(`[windows] native close prompt failed error=${error?.message || 'unknown'}`)
    return 'close-window'
  }
}
