import * as source0 from 'electron'
import * as source1 from 'node:crypto'
import * as source2 from 'node:fs'
import * as source3 from 'node:fs/promises'
import * as source4 from 'node:path'
import * as source5 from 'node:url'
import * as source6 from 'node:util'

export function createPlatformDependencies() {
  return {
    app: source0.app, BrowserWindow: source0.BrowserWindow, ClipboardItem: source0.ClipboardItem,
    Menu: source0.Menu, Notification: source0.Notification, Tray: source0.Tray,
    WebContentsView: source0.WebContentsView, clipboard: source0.clipboard, dialog: source0.dialog,
    ipcMain: source0.ipcMain, nativeImage: source0.nativeImage, screen: source0.screen,
    session: source0.session, shell: source0.shell,
    createHash: source1.createHash, randomUUID: source1.randomUUID,
    mkdirSync: source2.mkdirSync, rmSync: source2.rmSync,
    mkdir: source3.mkdir, readFile: source3.readFile, readdir: source3.readdir,
    rm: source3.rm, writeFile: source3.writeFile,
    path: source4,
    fileURLToPath: source5.fileURLToPath,
    TextDecoder: source6.TextDecoder,
  }
}
