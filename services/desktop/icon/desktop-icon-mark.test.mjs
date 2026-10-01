import assert from 'node:assert/strict'
import test from 'node:test'
import { inflateSync } from 'node:zlib'
import { desktopIconDataURL, desktopIconPNG } from './desktop-icon-mark.mjs'
import { encodePNG } from './icon-png.mjs'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function decodeSolid(png, size) {
  const idatStart = png.indexOf('IDAT', 0, 'ascii')
  const length = png.readUInt32BE(idatStart - 4)
  const raw = inflateSync(png.subarray(idatStart + 4, idatStart + 4 + length))
  const stride = size * 4
  const pixels = []
  for (let row = 0; row < size; row += 1) {
    assert.equal(raw[row * (stride + 1)], 0, 'scanlines must use filter 0')
    pixels.push(raw.subarray(row * (stride + 1) + 1, row * (stride + 1) + 1 + stride))
  }
  return pixels
}

test('the encoder produces a PNG every decoder can read back', () => {
  const size = 4
  const rgba = new Uint8ClampedArray(size * size * 4).fill(0)
  for (let pixel = 0; pixel < size * size; pixel += 1) {
    rgba[pixel * 4] = 10 + pixel
    rgba[pixel * 4 + 3] = 255
  }
  const png = encodePNG(size, size, rgba)
  assert.deepEqual(png.subarray(0, 8), SIGNATURE)
  assert.equal(png.readUInt32BE(16), size)
  assert.equal(png.readUInt32BE(20), size)
  assert.equal(png[24], 8, 'bit depth')
  assert.equal(png[25], 6, 'RGBA color type')
  const rows = decodeSolid(png, size)
  assert.equal(rows[0][0], 10)
  assert.equal(rows[3][12], 10 + 15)
})

test('the encoder refuses a buffer that does not match its dimensions', () => {
  assert.throws(() => encodePNG(2, 2, new Uint8ClampedArray(4)), /pixel buffer/)
  assert.throws(() => encodePNG(0, 2, new Uint8ClampedArray(0)), /dimensions/)
})

// This is the whole point of the module: `nativeImage` decodes PNG and JPEG
// only, so the SVG data URL this replaced was always an empty image.
test('the generated desktop mark is a real, non-empty PNG at every rendered size', () => {
  for (const size of [22, 32, 64, 256]) {
    const png = desktopIconPNG(size, 'main')
    assert.deepEqual(png.subarray(0, 8), SIGNATURE, `size ${size}`)
    assert.equal(png.readUInt32BE(16), size)
    assert.ok(png.length > 100, `size ${size} produced ${png.length} bytes`)
  }
})

test('the mark paints its backdrop, its accent and nothing outside the rounded corner', () => {
  const size = 64
  const rows = decodeSolid(desktopIconPNG(size, 'main'), size)
  const center = rows[32].subarray(32 * 4, 32 * 4 + 4)
  const backdrop = rows[32].subarray(4 * 4, 4 * 4 + 4)
  const corner = rows[0].subarray(0, 4)
  assert.equal(center[3], 255, 'the centre dot is opaque')
  assert.ok(center[0] + center[1] + center[2] > backdrop[0] + backdrop[1] + backdrop[2], 'the accent is brighter than the backdrop')
  assert.equal(backdrop[3], 255, 'the backdrop is opaque')
  assert.equal(corner[3], 0, 'the rounded corner stays transparent')
})

test('the mark is deterministic and accented per instance', () => {
  assert.deepEqual(desktopIconPNG(64, 'main'), desktopIconPNG(64, 'main'))
  assert.notDeepEqual(desktopIconPNG(64, 'dev azul'), desktopIconPNG(64, 'main'))
  assert.ok(desktopIconDataURL(32, 'main').startsWith('data:image/png;base64,'))
})
