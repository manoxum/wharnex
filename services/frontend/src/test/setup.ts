import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

// jsdom's File/Blob implementation does not implement arrayBuffer() (a
// long-standard Web API real browsers and Electron already support) —
// polyfill it via FileReader so tests exercising a file-upload flow work
// the same way it does in production.
if (typeof File !== 'undefined' && typeof File.prototype.arrayBuffer !== 'function') {
  File.prototype.arrayBuffer = function (this: File) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}

// jsdom's Range does not implement layout geometry (no real renderer to
// measure) — Quill's editor calls Range.getBoundingClientRect()/getClientRects()
// while scrolling a new selection into view, which is otherwise a hard crash
// in tests that drive ComposerRichEditor through its Quill instance.
if (typeof Range !== 'undefined' && typeof Range.prototype.getBoundingClientRect !== 'function') {
  const emptyRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect
  Range.prototype.getBoundingClientRect = emptyRect
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
}
