// Measured role-link artifact path: exact bounded attributes, never generic fallback.
export function inspectExactRoleLink(node, index, expected, main, nodes, fresh) {
  const excluded = '[data-message-author-role="user"], [class~="group/user-message"], form[data-chatgpt-composer], [data-composer-surface], nav, aside'
  const disabled = Boolean(node.disabled || node.getAttribute?.('aria-disabled') === 'true' || node.closest?.('[aria-disabled="true"], [inert]'))
  const visible = Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects?.().length)
  if (!main?.contains?.(node) || node.closest?.(excluded) || disabled || !visible || !fresh) return { index, visible: false }
  const filename = String(expected || '').trim().toLowerCase()
  const exact = Boolean(filename && ['download', 'aria-label', 'title', 'data-file-name'].some((field) => {
    const value = String(node.getAttribute?.(field) || '').slice(0, 512).toLowerCase()
    return (value.match(/[a-z0-9][a-z0-9_.-]{0,255}\.zip(?![a-z0-9_.-])/g) || []).includes(filename)
  }))
  return { index, visible: true, disabled: false, metadata: exact ? expected : '', latestAssistant: false, latestTurn: false, nested: exact && nodes.some((other, otherIndex) => otherIndex !== index && node.contains?.(other)), downloadSemantic: false, fileLike: exact, iconOnly: false }
}
