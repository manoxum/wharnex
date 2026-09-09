import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArtifactPresentationItem } from '../types'

export type ArtifactViewerItem = Pick<ArtifactPresentationItem, 'path' | 'size'> & Partial<Pick<ArtifactPresentationItem, 'preview_path' | 'label' | 'description' | 'alt' | 'content_type' | 'kind'>>
import { api } from '../lib/api'
import { artifactPreviewDefinition } from '../lib/artifactPreviewRegistry'
import { ArtifactPreview } from './ArtifactPreview'
import { Icon } from './Icon'

export function ArtifactViewerModal({ sessionId, bundleId, items, initialIndex, onClose }: {
  sessionId: string
  bundleId: string
  items: ArtifactViewerItem[]
  initialIndex: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(Math.max(0, Math.min(initialIndex, items.length - 1)))
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [flipX, setFlipX] = useState(1)
  const [flipY, setFlipY] = useState(1)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [saturation, setSaturation] = useState(100)
  const [grayscale, setGrayscale] = useState(0)
  const [mode, setMode] = useState<'preview' | 'raw'>('preview')
  const [wrap, setWrap] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const item = items[index]
  const definition = useMemo(() => artifactPreviewDefinition(item?.path || '', item?.kind), [item])
  const url = item ? api.artifactEntryURL(sessionId, bundleId, item.path) : ''

  useEffect(() => {
    setZoom(1); setRotation(0); setFlipX(1); setFlipY(1); setBrightness(100); setContrast(100); setSaturation(100); setGrayscale(0); setMode('preview'); setWrap(false)
  }, [index])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled])') || [])
    focusables()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key === 'ArrowLeft' && items.length > 1) { event.preventDefault(); setIndex((value) => (value - 1 + items.length) % items.length); return }
      if (event.key === 'ArrowRight' && items.length > 1) { event.preventDefault(); setIndex((value) => (value + 1) % items.length); return }
      if (event.key !== 'Tab') return
      const nodes = focusables(); if (!nodes.length) return
      const first = nodes[0]; const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown); previous?.focus() }
  }, [items.length, onClose])

  if (!item) return null
  const canRaw = definition.capabilities.includes('raw')
  const resetImage = () => { setZoom(1); setRotation(0); setFlipX(1); setFlipY(1); setBrightness(100); setContrast(100); setSaturation(100); setGrayscale(0) }
  return <div className="artifact-viewer-backdrop" role="presentation" data-chatgpt-overlay-blocker="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} className="artifact-viewer" role="dialog" aria-modal="true" aria-label={`Visualizar ${item.label || baseName(item.path)}`}>
      <header>
        <div><strong>{item.label || baseName(item.path)}</strong><small>{index + 1}/{items.length} · {formatBytes(item.size)} · {definition.kind}</small></div>
        <div className="artifact-viewer-actions">
          <a href={api.artifactEntryURL(sessionId, bundleId, item.path, true)} download title={`Descarregar ${item.path}`}><Icon name="download" size={13}/> Descarregar</a>
          <button type="button" className="icon-button light" onClick={onClose} aria-label="Fechar viewer"><Icon name="close" size={13}/></button>
        </div>
      </header>
      <div className="artifact-viewer-toolbar" aria-label="Ferramentas do ficheiro">
        {items.length > 1 && <><button type="button" onClick={() => setIndex((value) => (value - 1 + items.length) % items.length)}>← Anterior</button><button type="button" onClick={() => setIndex((value) => (value + 1) % items.length)}>Seguinte →</button></>}
        {definition.kind === 'image' && <>
          <button type="button" onClick={() => setZoom((value) => Math.max(.25, value - .25))}>− Zoom</button><button type="button" onClick={() => setZoom((value) => Math.min(4, value + .25))}>+ Zoom</button>
          <button type="button" onClick={() => setRotation((value) => value - 90)}>↺</button><button type="button" onClick={() => setRotation((value) => value + 90)}>↻</button>
          <button type="button" onClick={() => setFlipX((value) => -value)}>Inverter H</button><button type="button" onClick={() => setFlipY((value) => -value)}>Inverter V</button>
          <label>Brilho <input type="range" min="50" max="150" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))}/></label>
          <label>Contraste <input type="range" min="50" max="150" value={contrast} onChange={(event) => setContrast(Number(event.target.value))}/></label>
          <label>Saturação <input type="range" min="0" max="200" value={saturation} onChange={(event) => setSaturation(Number(event.target.value))}/></label>
          <button type="button" aria-pressed={grayscale > 0} onClick={() => setGrayscale((value) => value ? 0 : 100)}>P&B</button><button type="button" onClick={resetImage}>Reset</button>
        </>}
        {canRaw && <button type="button" aria-pressed={mode === 'raw'} onClick={() => setMode((value) => value === 'preview' ? 'raw' : 'preview')}>{mode === 'preview' ? 'Ver source' : 'Ver preview'}</button>}
        {definition.capabilities.includes('wrap') && <button type="button" aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>Quebrar linhas</button>}
      </div>
      {item.description && <p className="artifact-viewer-description">{item.description}</p>}
      <div className="artifact-viewer-stage">
        {definition.kind === 'image'
          ? <img src={url} alt={item.alt || item.label || item.path} style={{ transform: `scale(${zoom}) rotate(${rotation}deg) scaleX(${flipX}) scaleY(${flipY})`, filter: `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale}%)` }}/>
          : <ArtifactPreview path={item.path} size={item.size} url={url} kind={item.kind} mode={mode} wrap={wrap}/>}
      </div>
    </section>
  </div>
}

function baseName(path: string) { return path.split('/').pop() || path }
function formatBytes(size: number) { if (size < 1024) return `${size} B`; if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`; return `${(size / (1024 * 1024)).toFixed(1)} MB` }
