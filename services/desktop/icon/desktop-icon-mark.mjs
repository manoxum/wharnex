import { BRAND_ACCENT, desktopAccent } from '../identity/desktop-identity.mjs'
import { canvasPNG, circle, createIconCanvas, paint, ring, roundedRect, scaled, segment, union } from './icon-canvas.mjs'

// The same mark `desktopIconSVG` describes, rasterized instead of handed to
// nativeImage as SVG (which it cannot decode). Kept geometrically identical so
// the generated fallback and the installed raster are the same brand.
const GRID = 64
const BACKDROP = '#111310'
const DASH_SEGMENTS = 3
const RADIANS = Math.PI / 180

function dashedRing(cx, cy, radius, width, dash, gap, rotation) {
  const parts = []
  const step = (dash + gap) / radius
  const span = dash / radius
  for (let start = rotation; start < rotation + Math.PI * 2 - 1e-6; start += step) {
    for (let piece = 0; piece < DASH_SEGMENTS; piece += 1) {
      const from = start + (span * piece) / DASH_SEGMENTS
      const to = start + (span * (piece + 1)) / DASH_SEGMENTS
      parts.push(segment(cx + Math.cos(from) * radius, cy + Math.sin(from) * radius, cx + Math.cos(to) * radius, cy + Math.sin(to) * radius, width))
    }
  }
  return union(...parts)
}

// Below roughly 48px the dashes collapse into noise, so the small renders
// (a tray glyph above all) keep the silhouette and drop the detail.
export function desktopMarkPNG(size = 256, accent = BRAND_ACCENT) {
  const resolved = Math.max(16, Math.round(Number(size) || 256))
  const canvas = createIconCanvas(resolved)
  const factor = resolved / GRID
  paint(canvas, scaled(roundedRect(0, 0, 64, 64, 14), factor), BACKDROP)
  if (resolved >= 48) {
    paint(canvas, scaled(dashedRing(32, 32, 23.5, 4.1, 22, 13, 24 * RADIANS), factor), accent, 0.82)
    paint(canvas, scaled(dashedRing(32, 32, 14.5, 4.7, 15, 8, -18 * RADIANS), factor), accent, 0.95)
  } else {
    paint(canvas, scaled(ring(32, 32, 23.5, 4.1), factor), accent, 0.82)
    paint(canvas, scaled(ring(32, 32, 14.5, 4.7), factor), accent, 0.95)
  }
  paint(canvas, scaled(circle(32, 32, 6.7), factor), accent)
  return canvasPNG(canvas)
}

export function desktopIconPNG(size = 256, instance) {
  return desktopMarkPNG(size, desktopAccent(instance))
}

export function desktopIconDataURL(size = 256, instance) {
  return `data:image/png;base64,${desktopIconPNG(size, instance).toString('base64')}`
}
