import { useEffect, useState } from 'react'
import { parseDrawioDocument, type DrawioScene } from '../../../lib/artifacts/drawio/drawioModel'

const MAX_DRAWIO_PREVIEW_BYTES = 4 * 1024 * 1024

export function DrawioPreview({ path, url, size, compact = false }: { path: string; url: string; size: number; compact?: boolean }) {
  const [scene, setScene] = useState<DrawioScene>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    setScene(undefined); setError(''); setLoading(true)
    if (size > MAX_DRAWIO_PREVIEW_BYTES) {
      setError('O ficheiro Draw.io excede o limite seguro de 4 MB para pré-visualização.'); setLoading(false)
      return () => controller.abort()
    }
    void loadDrawioText(url, controller.signal).then(parseDrawioDocument).then((next) => {
      if (alive) setScene(next)
    }).catch((reason) => {
      if (alive && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Falha ao abrir o ficheiro Draw.io.')
    }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false; controller.abort() }
  }, [size, url])

  if (loading) return <div className="artifact-preview-empty"><span className="spinner"/>A abrir diagrama localmente…</div>
  if (error || !scene) return <div className="artifact-preview-empty composer-error">{error || 'Não foi possível renderizar o diagrama Draw.io.'}</div>
  return <div className={`artifact-drawio-preview ${compact ? 'is-compact' : ''}`}>
    <svg viewBox={scene.viewBox} role="img" aria-label={`Diagrama Draw.io: ${path}`} preserveAspectRatio="xMidYMid meet">
      <g aria-hidden="true">{scene.edges.map((edge) => <line key={edge.id} className="artifact-drawio-edge" x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2}/>)}</g>
      {scene.nodes.map((node) => <g key={node.id}>
        {node.shape === 'ellipse'
          ? <ellipse className="artifact-drawio-node" cx={node.x + node.width / 2} cy={node.y + node.height / 2} rx={node.width / 2} ry={node.height / 2}/>
          : node.shape === 'diamond'
            ? <polygon className="artifact-drawio-node" points={`${node.x + node.width / 2},${node.y} ${node.x + node.width},${node.y + node.height / 2} ${node.x + node.width / 2},${node.y + node.height} ${node.x},${node.y + node.height / 2}`}/>
            : <rect className="artifact-drawio-node" x={node.x} y={node.y} width={node.width} height={node.height} rx="6"/>}
        {node.label && <text className="artifact-drawio-label" x={node.x + node.width / 2} y={node.y + node.height / 2} textAnchor="middle" dominantBaseline="middle">{node.label}</text>}
      </g>)}
      {scene.edges.filter((edge) => edge.label).map((edge) => <text key={`${edge.id}-label`} className="artifact-drawio-label" x={(edge.x1 + edge.x2) / 2} y={(edge.y1 + edge.y2) / 2 - 6} textAnchor="middle">{edge.label}</text>)}
    </svg>
  </div>
}

async function loadDrawioText(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, headers: { Range: `bytes=0-${MAX_DRAWIO_PREVIEW_BYTES - 1}` } })
  if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`)
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (response.status === 200 && declaredLength > MAX_DRAWIO_PREVIEW_BYTES) throw new Error('O ficheiro Draw.io excede o limite seguro de 4 MB para pré-visualização.')
  if (!response.body) {
    const text = await response.text()
    if (new Blob([text]).size > MAX_DRAWIO_PREVIEW_BYTES) throw new Error('O ficheiro Draw.io excede o limite seguro de 4 MB para pré-visualização.')
    return text
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let text = ''; let received = 0; let truncated = false
  while (true) {
    const { done, value } = await reader.read(); if (done) break
    const remaining = MAX_DRAWIO_PREVIEW_BYTES - received
    if (remaining <= 0) { truncated = true; await reader.cancel(); break }
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value
    received += chunk.byteLength; text += decoder.decode(chunk, { stream: true })
    if (chunk.byteLength < value.byteLength) { truncated = true; await reader.cancel(); break }
  }
  text += decoder.decode()
  const ranged = response.headers.get('content-range')?.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i)
  if (truncated || Boolean(ranged && Number(ranged[2]) + 1 < Number(ranged[3]))) throw new Error('O ficheiro Draw.io está truncado ou excede o limite seguro de 4 MB para pré-visualização.')
  return text
}
