import { canvasPNG, circle, createIconCanvas, intersect, maxX, maxY, minX, paint, polygon, ring, roundedRect, scaled, segment, subtract, union } from './icon-canvas.mjs'

// Menu glyphs drawn on a 16-unit grid. They were SVG data URLs, which
// nativeImage decodes to an empty image, so every icon the tray control panel
// declared was in fact invisible.
const GRID = 16
const STROKE = 1.6
const THIN = 1.35
const DEFAULT_COLOR = '#9ca3af'
const DEFAULT_SIZE = 16
const DEFAULT_SCALE_FACTOR = 2

const GLYPHS = {
  project: union(ring(8, 8, 4.6, STROKE), circle(8, 8, 1.7)),
  bell: union(
    intersect(ring(8, 8.2, 3.6, STROKE), maxY(8.2)),
    segment(4.4, 8.2, 4.4, 10.4, STROKE),
    segment(11.6, 8.2, 11.6, 10.4, STROKE),
    segment(3.3, 10.6, 12.7, 10.6, STROKE),
    circle(8, 12.9, 1.2),
  ),
  plan: union(
    subtract(roundedRect(3.4, 2.6, 9.2, 10.8, 1.4), roundedRect(5, 4.2, 6, 7.6, 0.5)),
    segment(6.3, 7.1, 9.7, 7.1, THIN),
    segment(6.3, 9.6, 9.7, 9.6, THIN),
  ),
  play: polygon([[5.4, 3.2], [12.6, 8], [5.4, 12.8]]),
  pause: union(roundedRect(4.3, 3.4, 2.6, 9.2, 1), roundedRect(9.1, 3.4, 2.6, 9.2, 1)),
  workers: union(
    ring(4.9, 5.4, 1.9, THIN),
    ring(11.1, 5.4, 1.9, THIN),
    intersect(ring(4.9, 12.6, 2.8, THIN), maxY(12.6), maxX(7.9)),
    intersect(ring(11.1, 12.6, 2.8, THIN), maxY(12.6), minX(8.1)),
  ),
  network: union(
    ring(8, 8, 1.9, THIN),
    segment(2.6, 8, 5.3, 8, THIN),
    segment(10.7, 8, 13.4, 8, THIN),
    segment(8, 2.6, 8, 5.3, THIN),
    segment(8, 10.7, 8, 13.4, THIN),
  ),
  close: union(segment(4.5, 4.5, 11.5, 11.5, STROKE), segment(11.5, 4.5, 4.5, 11.5, STROKE)),
}
GLYPHS.resume = GLYPHS.play

export function glyphPNG(name, color = DEFAULT_COLOR, size = DEFAULT_SIZE) {
  const shape = GLYPHS[name] || GLYPHS.project
  const canvas = createIconCanvas(size)
  paint(canvas, scaled(shape, size / GRID), color)
  return canvasPNG(canvas)
}

// Building a NativeImage per menu item per rebuild was measurable churn on its
// own, and the set of distinct glyphs is tiny and fixed, so they are cached for
// the process lifetime.
export function createTrayGlyphs(nativeImage, { size = DEFAULT_SIZE, scaleFactor = DEFAULT_SCALE_FACTOR } = {}) {
  const cache = new Map()
  return function glyph(name, color = DEFAULT_COLOR) {
    const key = `${name}:${color}`
    const cached = cache.get(key)
    if (cached) return cached
    const image = typeof nativeImage.createFromBuffer === 'function'
      ? nativeImage.createFromBuffer(glyphPNG(name, color, size * scaleFactor), { width: size, height: size, scaleFactor })
      : nativeImage.createFromDataURL(`data:image/png;base64,${glyphPNG(name, color, size).toString('base64')}`)
    cache.set(key, image)
    return image
  }
}
