// Closed passive control metadata supplement. It never activates or scrolls.
export function describeComplementaryControlShape(document, nodes, owned, classify, shape) {
  const selector = '[role="link"], [download], [data-file-name], [data-filename], [data-testid*="resource"]'
  const found = [...document.querySelectorAll(selector)].filter(owned)
  const rows = found.slice(0, 128).map((node) => {
    const attrs = ['download', 'aria-label', 'title', 'data-file-name', 'data-filename'].map((field) => String(node.getAttribute?.(field) || '').slice(0, 512))
    const value = attrs.join(' ')
    const flags = classify('')
    for (const attr of attrs) {
      const match = classify(attr)
      for (const field of Object.keys(flags)) flags[field] ||= match[field]
    }
    const visible = Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects?.().length)
    return { ...shape(node), ...flags, visible, disabled: Boolean(node.disabled || node.getAttribute?.('aria-disabled') === 'true'), coveredByCapture: nodes.includes(node), zipFile: /\b[a-zA-Z0-9][a-zA-Z0-9_.-]{0,255}\.zip\b/i.test(value), hasFileNameAttribute: Boolean(node.hasAttribute?.('data-file-name') || node.hasAttribute?.('data-filename')), hasDownloadAttribute: node.hasAttribute?.('download') === true }
  })
  const result = { total: found.length, inspected: rows.length, truncated: found.length > 128 }
  for (const field of ['visible', 'disabled', 'response', 'expected', 'sameChat', 'sameRequest', 'zipFile']) result[field] = rows.filter((row) => row[field]).length
  result.hidden = rows.length - result.visible
  result.outsideCapture = rows.filter((row) => !row.coveredByCapture).length
  result.controls = rows.slice(0, 16)
  const number = (value) => Math.max(0, Math.min(1_000_000, Number.isFinite(value) ? Math.floor(value) : 0))
  const scroll = (node) => ({ top: number(node?.scrollTop), height: number(node?.scrollHeight), clientHeight: number(node?.clientHeight) })
  result.viewport = { width: number(document.defaultView?.innerWidth ?? document.documentElement?.clientWidth), height: number(document.defaultView?.innerHeight ?? document.documentElement?.clientHeight) }
  result.rootScroll = scroll(document.scrollingElement || document.documentElement)
  result.mainScroll = scroll(document.querySelector?.('main'))
  return result
}

export function normalizeComplementaryControlShape(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const number = (value) => Math.max(0, Math.min(1_000_000, Number.isFinite(value) ? Math.floor(value) : 0))
  const result = { truncated: source.truncated === true }
  for (const field of ['total', 'inspected', 'visible', 'hidden', 'disabled', 'outsideCapture', 'response', 'expected', 'sameChat', 'sameRequest', 'zipFile']) result[field] = number(source[field])
  result.controls = Array.isArray(source.controls) ? source.controls.slice(0, 16).map((row) => {
    const control = {}
    for (const field of ['tag', 'role', 'testid']) control[field] = typeof row?.[field] === 'string' ? row[field].slice(0, 64) : ''
    for (const field of ['response', 'expected', 'sameChat', 'sameRequest', 'visible', 'disabled', 'coveredByCapture', 'zipFile', 'hasFileNameAttribute', 'hasDownloadAttribute']) control[field] = row?.[field] === true
    return control
  }) : []
  result.viewport = { width: number(source.viewport?.width), height: number(source.viewport?.height) }
  for (const field of ['rootScroll', 'mainScroll']) result[field] = { top: number(source[field]?.top), height: number(source[field]?.height), clientHeight: number(source[field]?.clientHeight) }
  return result
}
