import { encodePNG } from './icon-png.mjs'

// A shape is a signed distance function in canvas units: negative inside,
// positive outside, measured in pixels. Antialiasing is then the analytic
// coverage of one pixel, which keeps a 16px menu glyph legible without any
// rasterizer dependency.
export function createIconCanvas(size) {
  return { size, data: new Float64Array(size * size * 4) }
}

function parseColor(value) {
  const hex = String(value || '').replace('#', '')
  const full = hex.length === 3 ? hex.split('').map((digit) => digit + digit).join('') : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Invalid icon color: ${value}`)
  return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255]
}

// Source-over into a premultiplied buffer, so overlapping strokes of the same
// colour compose without darkening their shared edge.
export function paint(canvas, shape, color, alpha = 1) {
  const [red, green, blue] = parseColor(color)
  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) {
      const distance = shape(x + 0.5, y + 0.5)
      if (!(distance < 0.5)) continue
      const coverage = Math.min(1, 0.5 - distance) * alpha
      if (coverage <= 0) continue
      const offset = (y * canvas.size + x) * 4
      const keep = 1 - coverage
      canvas.data[offset] = red * coverage + canvas.data[offset] * keep
      canvas.data[offset + 1] = green * coverage + canvas.data[offset + 1] * keep
      canvas.data[offset + 2] = blue * coverage + canvas.data[offset + 2] * keep
      canvas.data[offset + 3] = coverage + canvas.data[offset + 3] * keep
    }
  }
  return canvas
}

export function canvasPNG(canvas) {
  const rgba = new Uint8ClampedArray(canvas.size * canvas.size * 4)
  for (let pixel = 0; pixel < canvas.size * canvas.size; pixel += 1) {
    const offset = pixel * 4
    const alpha = canvas.data[offset + 3]
    const scale = alpha > 0 ? 255 / alpha : 0
    rgba[offset] = canvas.data[offset] * scale
    rgba[offset + 1] = canvas.data[offset + 1] * scale
    rgba[offset + 2] = canvas.data[offset + 2] * scale
    rgba[offset + 3] = alpha * 255
  }
  return encodePNG(canvas.size, canvas.size, rgba)
}

export const circle = (cx, cy, radius) => (x, y) => Math.hypot(x - cx, y - cy) - radius

export const ring = (cx, cy, radius, width) => (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - radius) - width / 2

export const segment = (x1, y1, x2, y2, width) => {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = dx * dx + dy * dy || 1
  return (x, y) => {
    const along = Math.min(1, Math.max(0, ((x - x1) * dx + (y - y1) * dy) / length))
    return Math.hypot(x - (x1 + along * dx), y - (y1 + along * dy)) - width / 2
  }
}

export const roundedRect = (left, top, width, height, radius) => (x, y) => {
  const dx = Math.abs(x - (left + width / 2)) - (width / 2 - radius)
  const dy = Math.abs(y - (top + height / 2)) - (height / 2 - radius)
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius
}

// Convex polygon, points wound clockwise in screen coordinates (y downwards).
export const polygon = (points) => {
  const edges = points.map((point, index) => {
    const next = points[(index + 1) % points.length]
    const nx = next[1] - point[1]
    const ny = point[0] - next[0]
    const length = Math.hypot(nx, ny) || 1
    return [nx / length, ny / length, point[0], point[1]]
  })
  return (x, y) => {
    let distance = -Infinity
    for (const [nx, ny, px, py] of edges) distance = Math.max(distance, (x - px) * nx + (y - py) * ny)
    return distance
  }
}

export const union = (...shapes) => (x, y) => {
  let distance = Infinity
  for (const shape of shapes) distance = Math.min(distance, shape(x, y))
  return distance
}

export const intersect = (...shapes) => (x, y) => {
  let distance = -Infinity
  for (const shape of shapes) distance = Math.max(distance, shape(x, y))
  return distance
}

export const subtract = (shape, hole) => (x, y) => Math.max(shape(x, y), -hole(x, y))

export const maxY = (limit) => (x, y) => y - limit

export const minY = (limit) => (x, y) => limit - y

export const maxX = (limit) => (x) => x - limit

export const minX = (limit) => (x) => limit - x

// Draws a shape designed on a fixed unit grid at an arbitrary canvas size.
export const scaled = (shape, factor) => (x, y) => shape(x / factor, y / factor) * factor
