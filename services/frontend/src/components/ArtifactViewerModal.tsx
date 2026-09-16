import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ArtifactPresentationItem } from '../types'

export type ArtifactViewerItem = Pick<ArtifactPresentationItem, 'path' | 'size'> & Partial<Pick<ArtifactPresentationItem, 'preview_path' | 'label' | 'description' | 'alt' | 'content_type' | 'kind'>>
import { api } from '../lib/api'
import { artifactPreviewDefinition } from '../lib/artifactPreviewRegistry'
import { ArtifactPreview } from './ArtifactPreview'
import { Icon } from './Icon'

export function ArtifactViewerModal({ sessionId, bundleId, artifactId, items, initialIndex, onClose }: {
  sessionId: string
  bundleId?: string
  artifactId?: string
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
  const [cropRatio, setCropRatio] = useState<'free' | '1/1' | '4/3' | '16/9'>('free')
  const [drawing, setDrawing] = useState(false)
  const [mode, setMode] = useState<'preview' | 'raw'>('preview')
  const [wrap, setWrap] = useState(false)
  const [mediaSpeed, setMediaSpeed] = useState(1)
  const [clipStart, setClipStart] = useState(0)
  const [clipEnd, setClipEnd] = useState(0)
  const [mediaExport, setMediaExport] = useState<'clip' | 'audio' | ''>('')
  const [mediaStatus, setMediaStatus] = useState('')
  const [documentMarker, setDocumentMarker] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  const drawCanvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const item = items[index]
  const definition = useMemo(() => artifactPreviewDefinition(item?.path || '', item?.kind), [item])
  const previewURL = item ? (bundleId ? api.artifactEntryURL(sessionId, bundleId, item.path) : artifactId ? api.artifactURL(sessionId, artifactId, true) : '') : ''
  const downloadURL = item ? (bundleId ? api.artifactEntryURL(sessionId, bundleId, item.path, true) : artifactId ? api.artifactURL(sessionId, artifactId) : '') : ''

  useEffect(() => {
    setZoom(1); setRotation(0); setFlipX(1); setFlipY(1); setBrightness(100); setContrast(100); setSaturation(100); setGrayscale(0); setCropRatio('free'); setDrawing(false); setMode('preview'); setWrap(false); setMediaSpeed(1); setClipStart(0); setClipEnd(0); setMediaExport(''); setMediaStatus(''); setDocumentMarker('')
  }, [index])

  useEffect(() => {
    const media = definition.kind === 'video' ? videoRef.current : definition.kind === 'audio' ? audioRef.current : null
    if (media) media.playbackRate = mediaSpeed
  }, [definition.kind, mediaSpeed])

  useEffect(() => {
    if (definition.kind !== 'image') return
    const canvas = drawCanvasRef.current
    if (!canvas) return
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = Math.max(1, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.round(rect.width * ratio))
      canvas.height = Math.max(1, Math.round(rect.height * ratio))
      const context = canvas.getContext('2d')
      context?.setTransform(ratio, 0, 0, ratio, 0, 0)
      if (context) { context.lineWidth = 2; context.lineCap = 'round'; context.lineJoin = 'round' }
    }
    resize()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize)
    observer?.observe(canvas)
    return () => observer?.disconnect()
  }, [cropRatio, definition.kind, index])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled])') || [])
    focusables()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      const target = event.target
      const editingControl = target instanceof HTMLElement && (target.matches('input, select, textarea') || target.isContentEditable)
      if (event.key === 'ArrowLeft' && items.length > 1 && !editingControl) { event.preventDefault(); setIndex((value) => (value - 1 + items.length) % items.length); return }
      if (event.key === 'ArrowRight' && items.length > 1 && !editingControl) { event.preventDefault(); setIndex((value) => (value + 1) % items.length); return }
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
  const resetImage = () => { setZoom(1); setRotation(0); setFlipX(1); setFlipY(1); setBrightness(100); setContrast(100); setSaturation(100); setGrayscale(0); setCropRatio('free'); setDrawing(false); clearDrawing() }
  function clearDrawing() { const canvas = drawCanvasRef.current; canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height) }
  function drawPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing) return
    const canvas = event.currentTarget; const context = canvas.getContext('2d'); if (!context) return
    const rect = canvas.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top
    if (event.type === 'pointerdown') { canvas.setPointerCapture(event.pointerId); context.beginPath(); context.moveTo(x, y) }
    else if (event.type === 'pointermove' && canvas.hasPointerCapture(event.pointerId)) { context.lineTo(x, y); context.stroke() }
    else if (event.type === 'pointerup' || event.type === 'pointercancel') { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); context.closePath() }
  }
  function currentMedia() { return definition.kind === 'video' ? videoRef.current : definition.kind === 'audio' ? audioRef.current : null }
  function seekMedia(seconds: number) {
    const media = currentMedia()
    if (!media) return
    const target = media.currentTime + seconds
    media.currentTime = Number.isFinite(media.duration) ? Math.max(0, Math.min(media.duration, target)) : Math.max(0, target)
  }
  function toggleMediaMute() { const media = currentMedia(); if (media) media.muted = !media.muted }
  function markClip(boundary: 'start' | 'end') {
    const media = currentMedia()
    if (!media) return
    const value = Math.max(0, Number.isFinite(media.duration) ? Math.min(media.duration, media.currentTime) : media.currentTime)
    if (boundary === 'start') setClipStart(Math.min(value, clipEnd || value))
    else setClipEnd(Math.max(value, clipStart))
    setMediaStatus(boundary === 'start' ? `Início marcado em ${formatDuration(value)}.` : `Fim marcado em ${formatDuration(value)}.`)
  }
  async function exportVideoSelection(audioOnly: boolean) {
    const video = videoRef.current
    if (!video || mediaExport) return
    const captureHost = video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }
    const capture = captureHost.captureStream || captureHost.mozCaptureStream
    if (!capture || typeof MediaRecorder === 'undefined') {
      setMediaStatus('Este navegador não suporta exportação local deste media.')
      return
    }
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    const start = Math.max(0, Math.min(clipStart, duration || clipStart))
    const end = Math.max(start, Math.min(clipEnd || duration, duration || clipEnd))
    if (!end || end <= start) {
      setMediaStatus('Defina um intervalo válido para exportar.')
      return
    }
    setMediaExport(audioOnly ? 'audio' : 'clip')
    setMediaStatus(audioOnly ? 'A extrair áudio durante a reprodução do intervalo…' : 'A gerar o corte durante a reprodução do intervalo…')
    const previousTime = video.currentTime
    const previousRate = video.playbackRate
    const wasPaused = video.paused
    let stream: MediaStream | undefined
    let recorder: MediaRecorder | undefined
    let onTimeUpdate: (() => void) | undefined
    try {
      stream = capture.call(captureHost)
      const tracks = audioOnly ? stream.getAudioTracks() : stream.getTracks()
      if (!tracks.length) throw new Error(audioOnly ? 'O vídeo não expõe uma faixa de áudio capturável.' : 'O vídeo não expõe faixas capturáveis.')
      const output = new MediaStream(tracks)
      const mime = preferredRecorderMime(audioOnly)
      recorder = mime ? new MediaRecorder(output, { mimeType: mime }) : new MediaRecorder(output)
      const chunks: BlobPart[] = []
      const stopped = new Promise<Blob>((resolve, reject) => {
        recorder!.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
        recorder!.onerror = () => reject(new Error('Falha ao processar o media no navegador.'))
        recorder!.onstop = () => resolve(new Blob(chunks, { type: recorder!.mimeType || (audioOnly ? 'audio/webm' : 'video/webm') }))
      })
      recorder.start(250)
      video.playbackRate = 1
      video.currentTime = start
      onTimeUpdate = () => {
        if (video.currentTime + 0.04 < end) return
        video.pause()
        if (recorder?.state !== 'inactive') recorder?.stop()
      }
      video.addEventListener('timeupdate', onTimeUpdate)
      await video.play()
      const blob = await stopped
      const downloadURL = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = downloadURL
      anchor.download = mediaExportName(item.path, audioOnly)
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadURL), 1_000)
      setMediaStatus(audioOnly ? 'Áudio extraído e preparado para download.' : 'Corte preparado para download.')
    } catch (error) {
      setMediaStatus(error instanceof Error ? error.message : 'Não foi possível exportar o media.')
      if (recorder?.state === 'recording') recorder.stop()
    } finally {
      if (onTimeUpdate) video.removeEventListener('timeupdate', onTimeUpdate)
      stream?.getTracks().forEach((track) => track.stop())
      video.playbackRate = previousRate
      video.currentTime = previousTime
      if (!wasPaused) void video.play().catch(() => undefined)
      setMediaExport('')
    }
  }
  return <div className="artifact-viewer-backdrop" role="presentation" data-chatgpt-overlay-blocker="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} className="artifact-viewer" role="dialog" aria-modal="true" aria-label={`Visualizar ${item.label || baseName(item.path)}`}>
      <header>
        <div className="artifact-viewer-heading">
          <span className="artifact-viewer-kind" aria-hidden="true"><Icon name="file" size={15}/></span>
          <div>
            <strong>{item.label || baseName(item.path)}</strong>
            <small><span>{index + 1}/{items.length}</span><span>{formatBytes(item.size)}</span><span>{definition.kind}</span></small>
          </div>
        </div>
        <div className="artifact-viewer-actions">
          <a className="artifact-viewer-download" href={downloadURL} download={baseName(item.path)} title={`Descarregar ${item.path}`}><Icon name="download" size={13}/> Descarregar</a>
          <button type="button" className="icon-button light" onClick={onClose} aria-label="Fechar viewer"><Icon name="close" size={13}/></button>
        </div>
      </header>
      <div className="artifact-viewer-toolbar" aria-label="Ferramentas do ficheiro">
        {items.length > 1 && <div className="artifact-viewer-tool-group" role="group" aria-label="Navegação"><button type="button" onClick={() => setIndex((value) => (value - 1 + items.length) % items.length)}>← Anterior</button><button type="button" onClick={() => setIndex((value) => (value + 1) % items.length)}>Seguinte →</button></div>}
        {definition.kind === 'image' && <>
          <div className="artifact-viewer-tool-group" role="group" aria-label="Escala e orientação">
            <button type="button" onClick={() => setZoom((value) => Math.max(.25, value - .25))}>− Zoom</button><output className="artifact-viewer-zoom" aria-label="Zoom atual">{Math.round(zoom * 100)}%</output><button type="button" onClick={() => setZoom((value) => Math.min(4, value + .25))}>+ Zoom</button>
            <span className="artifact-viewer-tool-divider" aria-hidden="true"/>
            <button type="button" title="Rodar 90° para a esquerda" onClick={() => setRotation((value) => value - 90)}>↺</button><button type="button" title="Rodar 90° para a direita" onClick={() => setRotation((value) => value + 90)}>↻</button>
            <button type="button" onClick={() => setFlipX((value) => -value)}>Inverter H</button><button type="button" onClick={() => setFlipY((value) => -value)}>Inverter V</button>
          </div>
          <div className="artifact-viewer-tool-group artifact-viewer-adjustments" role="group" aria-label="Ajustes de imagem">
            <label><span>Brilho <output>{brightness}%</output></span><input aria-label="Brilho" type="range" min="50" max="150" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))}/></label>
            <label><span>Contraste <output>{contrast}%</output></span><input aria-label="Contraste" type="range" min="50" max="150" value={contrast} onChange={(event) => setContrast(Number(event.target.value))}/></label>
            <label><span>Saturação <output>{saturation}%</output></span><input aria-label="Saturação" type="range" min="0" max="200" value={saturation} onChange={(event) => setSaturation(Number(event.target.value))}/></label>
            <label className="artifact-viewer-select-control"><span>Recorte</span><select aria-label="Recorte" value={cropRatio} onChange={(event) => setCropRatio(event.target.value as typeof cropRatio)}><option value="free">Livre</option><option value="1/1">1:1</option><option value="4/3">4:3</option><option value="16/9">16:9</option></select></label>
          </div>
          <div className="artifact-viewer-tool-group" role="group" aria-label="Edição temporária">
            <button type="button" aria-pressed={drawing} onClick={() => setDrawing((value) => !value)}>Desenhar</button><button type="button" onClick={clearDrawing}>Limpar traços</button>
            <button type="button" aria-pressed={grayscale > 0} onClick={() => setGrayscale((value) => value ? 0 : 100)}>P&B</button><button type="button" onClick={resetImage}>Reset</button>
          </div>
        </>}
        {canRaw && <div className="artifact-viewer-tool-group"><button type="button" aria-pressed={mode === 'raw'} onClick={() => setMode((value) => value === 'preview' ? 'raw' : 'preview')}>{mode === 'preview' ? 'Ver source' : 'Ver preview'}</button></div>}
        {definition.capabilities.includes('wrap') && <div className="artifact-viewer-tool-group"><button type="button" aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>Quebrar linhas</button></div>}
        {(definition.kind === 'video' || definition.kind === 'audio') && <div className="artifact-viewer-tool-group artifact-viewer-media-tools"><button type="button" onClick={() => seekMedia(-10)}>−10s</button><button type="button" onClick={() => seekMedia(10)}>+10s</button><button type="button" onClick={toggleMediaMute}>Mute</button><label className="artifact-viewer-select-control"><span>Velocidade</span><select value={mediaSpeed} onChange={(event) => setMediaSpeed(Number(event.target.value))}><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button type="button" onClick={() => markClip('start')}>Marcar início</button><button type="button" onClick={() => markClip('end')}>Marcar fim</button></div>}
        {definition.kind === 'video' && <div className="artifact-viewer-tool-group"><span className="artifact-media-range">{formatDuration(clipStart)}–{clipEnd ? formatDuration(clipEnd) : 'fim'}</span><button type="button" disabled={Boolean(mediaExport)} onClick={() => void exportVideoSelection(false)}>{mediaExport === 'clip' ? 'A cortar…' : 'Exportar corte'}</button><button type="button" disabled={Boolean(mediaExport)} onClick={() => void exportVideoSelection(true)}>{mediaExport === 'audio' ? 'A extrair…' : 'Extrair áudio'}</button></div>}
        {['markdown', 'text', 'office'].includes(definition.kind) && <div className="artifact-viewer-tool-group"><label className="artifact-document-marker">Marcador <input type="search" value={documentMarker} onChange={(event) => setDocumentMarker(event.target.value)} placeholder="Realçar termo…"/></label></div>}
      </div>
      <div className="artifact-viewer-notices">
        {item.description && <p className="artifact-viewer-description">{item.description}</p>}
        {mediaStatus && <div className="artifact-media-status" role="status">{mediaStatus}</div>}
      </div>
      <div className={`artifact-viewer-stage is-${definition.kind}`}>
        {definition.kind === 'image'
          ? <div className={`artifact-image-workbench ${drawing ? 'is-drawing' : ''}`} style={cropRatio === 'free' ? undefined : { aspectRatio: cropRatio }}><img src={previewURL} alt={item.alt || item.label || item.path} style={{ transform: `scale(${zoom}) rotate(${rotation}deg) scaleX(${flipX}) scaleY(${flipY})`, filter: `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale}%)`, objectFit: cropRatio === 'free' ? 'contain' : 'cover' }}/><canvas ref={drawCanvasRef} onPointerDown={drawPointer} onPointerMove={drawPointer} onPointerUp={drawPointer} onPointerCancel={drawPointer}/></div>
          : definition.kind === 'video' ? <video key={previewURL} src={previewURL} controls preload="metadata" ref={videoRef} onLoadedMetadata={(event) => { const duration = event.currentTarget.duration; if (Number.isFinite(duration)) setClipEnd(duration) }}/>
          : definition.kind === 'audio' ? <audio key={previewURL} src={previewURL} controls preload="metadata" ref={audioRef} onLoadedMetadata={(event) => { const duration = event.currentTarget.duration; if (Number.isFinite(duration)) setClipEnd(duration) }}/>
          : <ArtifactPreview sessionId={sessionId} path={item.path} size={item.size} url={previewURL} kind={item.kind} mode={mode} wrap={wrap} highlight={documentMarker}/>}
      </div>
    </section>
  </div>
}

function baseName(path: string) { return path.split('/').pop() || path }
function formatBytes(size: number) { if (size < 1024) return `${size} B`; if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`; return `${(size / (1024 * 1024)).toFixed(1)} MB` }

function preferredRecorderMime(audioOnly: boolean) {
  const candidates = audioOnly
    ? ['audio/webm;codecs=opus', 'audio/webm']
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || ''
}
function mediaExportName(path: string, audioOnly: boolean) {
  const name = baseName(path)
  const stem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name
  return `${stem}${audioOnly ? '-audio' : '-corte'}.webm`
}
function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00'
  const whole = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}
