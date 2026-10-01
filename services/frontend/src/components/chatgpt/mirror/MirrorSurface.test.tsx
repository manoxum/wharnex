import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MirrorSurface } from './MirrorSurface'

afterEach(() => cleanup())

it('draws the live frames and forwards the user input normalised to the drawn image', async () => {
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:frame'), revokeObjectURL: vi.fn() })
  let emit: (frame: DesktopMirrorFrame) => void = () => undefined
  const send = vi.fn().mockResolvedValue({ ok: true })
  render(<MirrorSurface subscribe={(callback) => { emit = callback; return () => undefined }} send={send} label="Espelho" />)
  expect(screen.getByText('A ligar ao navegador…')).toBeTruthy()
  act(() => emit({ width: 1000, height: 500, data: new Uint8Array([1]) }))
  const surface = screen.getByRole('application', { name: 'Espelho' })
  const image = surface.querySelector('img')!
  // A 1000x1000 box draws the 2:1 frame letterboxed at 1000x500, 250px down.
  image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, x: 0, y: 0, toJSON: () => ({}) })
  fireEvent.mouseDown(surface, { clientX: 500, clientY: 375, button: 0, buttons: 1, detail: 1 })
  expect(send).toHaveBeenCalledWith({ type: 'mousePressed', nx: 0.5, ny: 0.25, modifiers: 0, button: 'left', buttons: 1, clickCount: 1 })
  fireEvent.keyDown(surface, { key: 'v', code: 'KeyV', keyCode: 86, ctrlKey: true })
  expect(send).toHaveBeenLastCalledWith({ type: 'keyDown', key: 'v', code: 'KeyV', keyCode: 86, modifiers: 2 })
})
