import { normalizeComplementaryControlShape } from './complement-shape.mjs'

// Passive resource/control metadata only. No response, URL or filename is returned.
export function describeOwnedResourceShape(document, nodes, markers, expected, complement) {
  const filename = String(expected || '')
  const contracted = /^whx_bundle_res_[a-zA-Z0-9_-]+_req_[a-zA-Z0-9_-]+\.zip$/.test(filename)
  const chatPrefix = contracted ? filename.slice(0, filename.indexOf('_req_') + 1) : ''
  const requestSuffix = contracted ? filename.slice(filename.lastIndexOf('_req_')) : ''
  const main = document.querySelector?.('main')
  const excluded = '[data-message-author-role="user"], [class~="group/user-message"], form[data-chatgpt-composer], [data-composer-surface], nav, aside'
  const owned = (node) => !node?.closest?.(excluded) && Boolean(main?.contains?.(node) || node?.closest?.('[data-turn-id], [data-testid^="conversation-turn-"], article'))
  const cardSelector = '[class~="group/resource-card"], [data-testid*="file"], [data-testid*="attachment"], a[download]'
  const cards = [...document.querySelectorAll(cardSelector)].filter(owned).slice(0, 64)
  const totals = { cards: cards.length, labels: 0, expected: 0, sameChat: 0, sameRequest: 0, otherResponse: 0, response: 0 }
  const classify = (value) => {
    const names = String(value || '').slice(0, 512).match(/whx_bundle_res_[a-zA-Z0-9_-]{1,240}\.zip/g) || []
    return { response: names.length > 0, expected: names.includes(filename), sameChat: Boolean(chatPrefix && names.some((name) => name.startsWith(chatPrefix))), sameRequest: Boolean(requestSuffix && names.some((name) => name.endsWith(requestSuffix))) }
  }
  const classifyNode = (node, resourceLabel = false) => {
    const values = ['download', 'aria-label', 'title'].map((attr) => node?.getAttribute?.(attr) || '')
    if (resourceLabel && !node?.children?.length && !node?.closest?.('code, pre, [class~="markdown"], [class~="sr-only"]')) values.push(String(node.textContent || '').slice(0, 512))
    const flags = classify(values.join(' '))
    if (flags.response) {
      totals.labels += 1
      for (const field of ['response', 'expected', 'sameChat', 'sameRequest']) if (flags[field]) totals[field] += 1
      if (!flags.sameChat) totals.otherResponse += 1
    }
    return flags
  }
  const controls = nodes.filter(owned).slice(0, 256).map((node) => ({ node, flags: classifyNode(node) })).filter(({ flags }) => flags.response)
  const resources = cards.map((card) => {
    const flags = classifyNode(card)
    const labels = [...(card.querySelectorAll?.('[data-testid*="file-name"], [class*="file-name"], [class*="filename"], [class~="truncate"]') || [])].slice(0, 8)
    for (const label of labels) {
      const found = classifyNode(label, true)
      for (const field of ['response', 'expected', 'sameChat', 'sameRequest']) flags[field] ||= found[field]
    }
    return { card, flags }
  })
  const shape = (node) => ({ tag: String(node?.tagName || '').toLowerCase().slice(0, 20), role: String(node?.getAttribute?.('role') || '').slice(0, 32), testid: String(node?.getAttribute?.('data-testid') || '').slice(0, 64) })
  const markerAncestors = []
  let ancestor = markers[markers.length - 1]?.parentElement
  for (let depth = 1; ancestor && depth <= 6; depth += 1, ancestor = ancestor.parentElement) {
    markerAncestors.push({ depth, ...shape(ancestor), cards: cards.filter((card) => ancestor.contains?.(card)).length, controls: nodes.filter((node) => ancestor.contains?.(node)).length })
    if (ancestor === main) break
  }
  return { ...totals, mainFound: Boolean(main), scopedControls: nodes.filter(owned).length, controls: controls.slice(0, 16).map(({ node, flags }) => ({ ...shape(node), ...flags })), resources: resources.slice(0, 16).map(({ card, flags }) => ({ ...shape(card), ...flags })), markerAncestors, complement: typeof complement === 'function' ? complement(document, nodes, owned, classify, shape) : {} }
}

export function normalizeOwnedResourceShape(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const count = (value) => Math.max(0, Math.min(1_000_000, Number.isFinite(value) ? Math.floor(value) : 0))
  const shape = (row) => Object.fromEntries(['tag', 'role', 'testid'].map((field) => [field, typeof row?.[field] === 'string' ? row[field].slice(0, 64) : '']))
  const flags = (row) => Object.fromEntries(['response', 'expected', 'sameChat', 'sameRequest'].map((field) => [field, row?.[field] === true]))
  const result = { mainFound: source.mainFound === true, unavailable: source.unavailable === true }
  for (const field of ['cards', 'labels', 'expected', 'sameChat', 'sameRequest', 'otherResponse', 'response', 'scopedControls']) result[field] = count(source[field])
  for (const field of ['controls', 'resources']) result[field] = Array.isArray(source[field]) ? source[field].slice(0, 16).map((row) => ({ ...shape(row), ...flags(row) })) : []
  result.markerAncestors = Array.isArray(source.markerAncestors) ? source.markerAncestors.slice(0, 6).map((row) => ({ depth: Math.min(6, count(row?.depth)), ...shape(row), cards: count(row?.cards), controls: count(row?.controls) })) : []
  result.complement = normalizeComplementaryControlShape(source.complement)
  return result
}
