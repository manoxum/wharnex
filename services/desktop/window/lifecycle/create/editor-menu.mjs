export function installLocalEditorContextMenu(win, { Menu, spellcheckContextMenuTemplate }) {
  win.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return
    const template = spellcheckContextMenuTemplate(params, {
      replaceMisspelling: (suggestion) => {
        if (!win.isDestroyed()) win.webContents.replaceMisspelling(suggestion)
      },
      addToDictionary: (word) => {
        if (!win.isDestroyed()) win.webContents.session.addWordToSpellCheckerDictionary(word)
      },
    })
    if (!template.length || win.isDestroyed()) return
    Menu.buildFromTemplate(template).popup({ window: win, x: params.x, y: params.y })
  })
}
