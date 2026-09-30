import { writeFileSync } from 'node:fs'
import { desktopMarkPNG } from './desktop-icon-mark.mjs'

// `install-dev.sh` rasterized the installed icon with ImageMagick `convert`,
// so the PNG the tray and the desktop entry prefer simply did not exist on a
// host without it. This rasterizes the same mark with the Node standard
// library alone, which is what `AGENTS.md` §11 asks of a lifecycle task.
const [target, size, accent] = process.argv.slice(2)
if (!target) {
  console.error('usage: write-desktop-icon.mjs <output.png> [size] [#rrggbb]')
  process.exit(2)
}

const png = desktopMarkPNG(Number(size) || 256, accent || undefined)
writeFileSync(target, png, { mode: 0o644 })
