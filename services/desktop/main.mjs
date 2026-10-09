// Electron composition root. Self-evolution host builds syntax-check this
// entry point before activation; the composition itself lives in its stages.
import { composeDesktop } from './composition/entry/index.mjs'

const desktop = composeDesktop(import.meta.url)
desktop.app.whenReady().then(() => desktop.desktopEntrypoint.start())
desktop.desktopEntrypoint.registerLifecycle()
