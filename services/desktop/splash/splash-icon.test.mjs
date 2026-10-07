import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveSplashIcon, splashIdentity } from './splash-icon.mjs'

test('splash identity matches the installed per-checkout desktop entry', () => {
  assert.deepEqual(splashIdentity({ WHARNESS_INSTANCE_ID: 'WHX Demo' }), { instance: 'WHX Demo', desktopName: 'wharnex-whx-demo.desktop' })
  assert.equal(splashIdentity({}, 'checkout-name').desktopName, 'wharnex-checkout-name.desktop')
})

test('uses the installed raster icon from the host location, ignoring an IDE private XDG directory', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharnex-splash-icon-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const iconFile = path.join(root, 'icons/hicolor/256x256/apps/wharnex-demo.png')
  await mkdir(path.dirname(iconFile), { recursive: true }); await writeFile(iconFile, 'fixture')
  const image = { isEmpty: () => false }
  const nativeImage = { createFromPath(file) { assert.equal(file, iconFile); return image }, createFromDataURL() { assert.fail('installed icon should be used') } }
  assert.equal(resolveSplashIcon(nativeImage, { WHARNESS_INSTANCE_ID: 'demo', WHARNESS_DESKTOP_DATA_HOME: root, XDG_DATA_HOME: '/IDE/private' }), image)
})

test('falls back to a decodable PNG rather than SVG', () => {
  const nativeImage = { createFromDataURL(data) { assert.match(data, /^data:image\/png;base64,/); return data } }
  assert.match(resolveSplashIcon(nativeImage, { WHARNESS_DESKTOP_DATA_HOME: '/nonexistent' }), /^data:image\/png/)
})
