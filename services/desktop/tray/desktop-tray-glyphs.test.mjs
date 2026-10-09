import assert from 'node:assert/strict'
import test from 'node:test'
import { inflateSync } from 'node:zlib'
import { createTrayGlyphs, glyphPNG } from './desktop-tray-glyphs.mjs'

const NAMES = ['project', 'bell', 'plan', 'play', 'pause', 'resume', 'workers', 'network', 'close']

function coverage(png, size) {
  const idatStart = png.indexOf('IDAT', 0, 'ascii')
  const length = png.readUInt32BE(idatStart - 4)
  const raw = inflateSync(png.subarray(idatStart + 4, idatStart + 4 + length))
  const stride = size * 4
  let painted = 0
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (raw[row * (stride + 1) + 1 + column * 4 + 3] > 0) painted += 1
    }
  }
  return painted / (size * size)
}

// Every glyph the tray control panel declares used to be an SVG data URL, which
// nativeImage decodes to an empty image, so the icons were invisible.
test('every tray glyph rasterizes to visible pixels inside its box', () => {
  for (const name of NAMES) {
    const painted = coverage(glyphPNG(name, '#9ca3af', 16), 16)
    assert.ok(painted > 0.04, `${name} painted only ${(painted * 100).toFixed(1)}% of its box`)
    assert.ok(painted < 0.85, `${name} painted ${(painted * 100).toFixed(1)}% of its box`)
  }
})

test('an unknown glyph name degrades to the project mark rather than a blank image', () => {
  assert.deepEqual(glyphPNG('does-not-exist', '#9ca3af', 16), glyphPNG('project', '#9ca3af', 16))
})

test('glyph colour is honoured and rejected when it is not a fillable colour', () => {
  assert.notDeepEqual(glyphPNG('project', '#b9ff56', 16), glyphPNG('project', '#9ca3af', 16))
  assert.throws(() => glyphPNG('project', 'hsl(120 72% 55%)', 16), /Invalid icon color/)
})

test('glyph images are cached per name and colour', () => {
  let built = 0
  const glyph = createTrayGlyphs({ createFromDataURL: (dataUrl) => { built += 1; return { dataUrl } } })
  const first = glyph('bell', '#9ca3af')
  assert.equal(glyph('bell', '#9ca3af'), first)
  assert.notEqual(glyph('bell', '#b9ff56'), first)
  assert.equal(built, 2)
})

test('a HiDPI-capable nativeImage receives 2x and Linux-compatible 1x representations', () => {
  const calls = []
  const representations = []
  const glyph = createTrayGlyphs({
    createFromBuffer: (buffer, options) => {
      calls.push([buffer, options])
      return { buffer, options, addRepresentation: (representation) => representations.push(representation) }
    },
    createFromDataURL: () => { throw new Error('should not fall back') },
  })
  glyph('close', '#9ca3af')
  assert.deepEqual(calls[0][1], { width: 16, height: 16, scaleFactor: 2 })
  assert.equal(calls[0][0].readUInt32BE(16), 32)
  assert.deepEqual(representations[0], {
    buffer: glyphPNG('close', '#9ca3af', 16), width: 16, height: 16, scaleFactor: 1,
  })
})
