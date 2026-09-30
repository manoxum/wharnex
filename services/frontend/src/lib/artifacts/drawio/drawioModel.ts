export type DrawioNode = {
  id: string
  x: number
  y: number
  width: number
  height: number
  label: string
  shape: 'rect' | 'ellipse' | 'diamond'
}

export type DrawioEdge = {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
}

export type DrawioScene = {
  nodes: DrawioNode[]
  edges: DrawioEdge[]
  viewBox: string
}

const MAX_DRAWIO_CELLS = 1_500
const MAX_EXPANDED_DRAWIO_BYTES = 16 * 1024 * 1024

export async function parseDrawioDocument(source: string): Promise<DrawioScene> {
  const model = await graphModelFromSource(source)
  const cells = Array.from(model.getElementsByTagName('mxCell'))
  if (cells.length > MAX_DRAWIO_CELLS) throw new Error('O diagrama excede o limite seguro de objetos para pré-visualização.')

  const rawNodes = new Map<string, { cell: Element; x: number; y: number; width: number; height: number }>()
  for (const cell of cells) {
    if (cell.getAttribute('vertex') !== '1') continue
    const geometry = directChild(cell, 'mxGeometry')
    if (!geometry) continue
    const id = cell.getAttribute('id') || `vertex-${rawNodes.size}`
    rawNodes.set(id, {
      cell,
      x: finiteNumber(geometry.getAttribute('x'), 0),
      y: finiteNumber(geometry.getAttribute('y'), 0),
      width: Math.max(8, finiteNumber(geometry.getAttribute('width'), 120)),
      height: Math.max(8, finiteNumber(geometry.getAttribute('height'), 60)),
    })
  }
  if (!rawNodes.size) throw new Error('O diagrama não contém objetos visuais suportados para pré-visualização.')

  const positions = new Map<string, { x: number; y: number }>()
  const absolutePosition = (id: string, seen = new Set<string>()): { x: number; y: number } => {
    const cached = positions.get(id)
    if (cached) return cached
    const node = rawNodes.get(id)
    if (!node || seen.has(id)) return { x: 0, y: 0 }
    const nextSeen = new Set(seen).add(id)
    const parent = node.cell.getAttribute('parent') || ''
    const parentPosition = rawNodes.has(parent) ? absolutePosition(parent, nextSeen) : { x: 0, y: 0 }
    const position = { x: node.x + parentPosition.x, y: node.y + parentPosition.y }
    positions.set(id, position)
    return position
  }

  const nodes = Array.from(rawNodes, ([id, raw]) => {
    const position = absolutePosition(id)
    return {
      id,
      x: position.x,
      y: position.y,
      width: raw.width,
      height: raw.height,
      label: safeLabel(raw.cell.getAttribute('value') || ''),
      shape: shapeFromStyle(raw.cell.getAttribute('style') || ''),
    } satisfies DrawioNode
  })
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges: DrawioEdge[] = []
  for (const cell of cells) {
    if (cell.getAttribute('edge') !== '1') continue
    const source = nodeById.get(cell.getAttribute('source') || '')
    const target = nodeById.get(cell.getAttribute('target') || '')
    if (!source || !target) continue
    edges.push({
      id: cell.getAttribute('id') || `edge-${edges.length}`,
      x1: source.x + source.width / 2,
      y1: source.y + source.height / 2,
      x2: target.x + target.width / 2,
      y2: target.y + target.height / 2,
      label: safeLabel(cell.getAttribute('value') || ''),
    })
  }
  const minX = Math.min(...nodes.map((node) => node.x)) - 32
  const minY = Math.min(...nodes.map((node) => node.y)) - 32
  const maxX = Math.max(...nodes.map((node) => node.x + node.width)) + 32
  const maxY = Math.max(...nodes.map((node) => node.y + node.height)) + 32
  return { nodes, edges, viewBox: `${minX} ${minY} ${Math.max(64, maxX - minX)} ${Math.max(64, maxY - minY)}` }
}

async function graphModelFromSource(source: string): Promise<Element> {
  if (/<!DOCTYPE/i.test(source)) throw new Error('O ficheiro Draw.io contém uma declaração XML não permitida.')
  const document = parseXml(source)
  if (document.documentElement.tagName === 'mxGraphModel') return document.documentElement
  if (document.documentElement.tagName !== 'mxfile') throw new Error('O ficheiro não contém um mxfile ou mxGraphModel válido.')
  const diagram = document.getElementsByTagName('diagram')[0]
  if (!diagram) throw new Error('O ficheiro Draw.io não contém nenhum diagrama.')
  const inlineModel = diagram.getElementsByTagName('mxGraphModel')[0]
  if (inlineModel) return inlineModel
  const encoded = (diagram.textContent || '').trim()
  if (!encoded) throw new Error('O diagrama Draw.io está vazio.')
  const decoded = encoded.startsWith('<') ? encoded : encoded.toLowerCase().startsWith('%3c') ? decodeURIComponent(encoded) : await decodeCompressedDiagram(encoded)
  const decodedDocument = parseXml(decoded)
  if (decodedDocument.documentElement.tagName !== 'mxGraphModel') throw new Error('O conteúdo Draw.io descodificado não é um mxGraphModel válido.')
  return decodedDocument.documentElement
}

function parseXml(source: string) {
  const document = new DOMParser().parseFromString(source, 'application/xml')
  if (document.getElementsByTagName('parsererror').length) throw new Error('O ficheiro Draw.io contém XML inválido ou truncado.')
  return document
}

async function decodeCompressedDiagram(encoded: string) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não suporta a descompressão local necessária para este ficheiro Draw.io.')
  let compressed: Uint8Array
  try {
    const binary = atob(encoded.replace(/\s+/g, ''))
    compressed = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw new Error('O conteúdo comprimido do ficheiro Draw.io é inválido.')
  }
  try {
    const compressedBuffer = Uint8Array.from(compressed).buffer
    const stream = new Blob([compressedBuffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    const reader = stream.getReader()
    const decoder = new TextDecoder('utf-8')
    let text = ''
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_EXPANDED_DRAWIO_BYTES) { await reader.cancel(); throw new Error('O diagrama expandido excede o limite seguro de pré-visualização.') }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return decodeURIComponent(text)
  } catch (error) {
    if (error instanceof Error && error.message.includes('limite seguro')) throw error
    throw new Error('Não foi possível descomprimir o conteúdo Draw.io localmente.')
  }
}

function directChild(element: Element, tagName: string) {
  return Array.from(element.children).find((child) => child.tagName === tagName)
}

function finiteNumber(value: string | null, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(-1_000_000, Math.min(1_000_000, number)) : fallback
}

function safeLabel(value: string) {
  return value.replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
}

function shapeFromStyle(style: string): DrawioNode['shape'] {
  const normalized = style.toLowerCase()
  if (normalized.includes('ellipse')) return 'ellipse'
  if (normalized.includes('rhombus')) return 'diamond'
  return 'rect'
}
