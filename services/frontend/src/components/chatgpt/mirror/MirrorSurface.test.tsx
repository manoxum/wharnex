import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MirrorSurface } from './MirrorSurface'

const drawImage = vi.fn()
let decodes: Array<(bitmap: ImageBitmap) => void> = []

beforeEach(() => {
  decodes = []
  drawImage.mockClear()
  vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise<ImageBitmap>((resolve) => decodes.push(resolve))))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const bitmap = (width: number, height: number) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap

it('draws each frame into a canvas and acknowledges it only once drawn', async () => {
  let emit: DesktopMirrorFrameHandler = () => undefined
  const ready = vi.fn()
  render(<MirrorSurface subscribe={(onFrame) => { emit = onFrame; return () => undefined }} send={vi.fn()} label="Espelho" />)
  expect(screen.getByText('A ligar ao navegador…')).toBeTruthy()
  act(() => emit({ width: 1000, height: 500, data: new Uint8Array([1]) }, ready))
  expect(createImageBitmap).toHaveBeenCalledTimes(1)
  // The stream waits for this acknowledgement before sending the next frame.
  expect(ready).not.toHaveBeenCalled()
  await act(async () => { decodes[0](bitmap(1000, 500)) })
  expect(drawImage).toHaveBeenCalledTimes(1)
  expect(ready).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('A ligar ao navegador…')).toBeNull()
  expect(document.querySelector('img')).toBeNull()
  // A frame that still arrives mid-decode replaces the queued one.
  act(() => {
    emit({ width: 1000, height: 500, data: new Uint8Array([2]) }, ready)
    emit({ width: 1000, height: 500, data: new Uint8Array([3]) }, ready)
  })
  await act(async () => { decodes[1](bitmap(1000, 500)) })
  await waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(3))
})

it('forwards the user input normalised to the drawn frame', async () => {
  let emit: DesktopMirrorFrameHandler = () => undefined
  const send = vi.fn().mockResolvedValue({ ok: true })
  render(<MirrorSurface subscribe={(onFrame) => { emit = onFrame; return () => undefined }} send={send} label="Espelho" />)
  act(() => emit({ width: 1000, height: 500, data: new Uint8Array([1]) }, vi.fn()))
  await act(async () => { decodes[0](bitmap(1000, 500)) })
  const surface = screen.getByRole('application', { name: 'Espelho' })
  const canvas = surface.querySelector('canvas')!
  // A 1000x1000 box draws the 2:1 frame letterboxed at 1000x500, 250px down.
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, x: 0, y: 0, toJSON: () => ({}) })
  fireEvent.mouseDown(surface, { clientX: 500, clientY: 375, button: 0, buttons: 1, detail: 1 })
  expect(send).toHaveBeenCalledWith({ type: 'mousePressed', nx: 0.5, ny: 0.25, modifiers: 0, button: 'left', buttons: 1, clickCount: 1 })
  fireEvent.keyDown(surface, { key: 'v', code: 'KeyV', keyCode: 86, ctrlKey: true })
  expect(send).toHaveBeenLastCalledWith({ type: 'keyDown', key: 'v', code: 'KeyV', keyCode: 86, modifiers: 2 })
})
