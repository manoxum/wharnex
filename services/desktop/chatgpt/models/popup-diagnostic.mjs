// Only structural controls inside the explicitly linked owned model popup.
// No text, href, arbitrary attributes, navigation or input is inspected here.
export function inspectModelPopup(document, trigger, menu, visible, excluded, optionCount) {
  const controls = menu ? [...menu.querySelectorAll('button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="option"],[role="slider"],[aria-haspopup]')].filter((node) => visible(node) && !excluded(node)).slice(0, 64) : []
  const attr = (node, name) => String(node?.getAttribute?.(name) || '').slice(0, 80)
  const shape = (node) => {
    const controlled = attr(node, 'aria-controls')
    const linked = controlled ? document.getElementById(controlled) : null
    const rect = node?.getBoundingClientRect?.()
    return { tag: node?.tagName || '', role: attr(node, 'role'), hasPopup: attr(node, 'aria-haspopup'), expanded: attr(node, 'aria-expanded') === 'true' || attr(node, 'data-state') === 'open', selected: attr(node, 'aria-checked') === 'true' || attr(node, 'aria-selected') === 'true' || attr(node, 'data-state') === 'checked', disabled: Boolean(node?.disabled || attr(node, 'aria-disabled') === 'true' || node?.hasAttribute?.('data-disabled')), hasControls: Boolean(controlled), linked: Boolean(linked), linkedVisible: Boolean(linked && visible(linked)), linkedRole: attr(linked, 'role'), bounds: { left: rect?.left, top: rect?.top, width: rect?.width, height: rect?.height } }
  }
  return { trigger: shape(trigger), menu: shape(menu), controlCount: controls.length, sliderCount: controls.filter((node) => attr(node, 'role') === 'slider').length, submenuCount: controls.filter((node) => ['true', 'menu', 'listbox', 'dialog'].includes(attr(node, 'aria-haspopup'))).length, optionCount, controls: controls.slice(0, 16).map(shape) }
}

export function normalizeModelPopupDiagnostic(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const roles = new Set(['', 'button', 'menuitem', 'menuitemradio', 'option', 'slider', 'menu', 'listbox', 'dialog', 'combobox'])
  const popups = new Set(['', 'true', 'false', 'menu', 'listbox', 'tree', 'grid', 'dialog'])
  const tags = new Set(['', 'A', 'BUTTON', 'DIV', 'INPUT', 'SELECT', 'SPAN'])
  const number = (value) => Number.isFinite(value) ? Math.max(-1_000_000, Math.min(1_000_000, Math.round(value))) : null
  const count = (value) => Number.isFinite(value) ? Math.max(0, Math.min(64, Math.floor(value))) : 0
  const shape = (node = {}) => ({ tag: tags.has(node.tag) ? node.tag : 'OTHER', role: roles.has(node.role) ? node.role : 'other', hasPopup: popups.has(node.hasPopup) ? node.hasPopup : 'other', expanded: node.expanded === true, selected: node.selected === true, disabled: node.disabled === true, hasControls: node.hasControls === true, linked: node.linked === true, linkedVisible: node.linkedVisible === true, linkedRole: roles.has(node.linkedRole) ? node.linkedRole : 'other', bounds: Object.fromEntries(['left', 'top', 'width', 'height'].map((key) => [key, number(node.bounds?.[key])])) })
  return { trigger: shape(source.trigger), menu: shape(source.menu), controlCount: count(source.controlCount), sliderCount: count(source.sliderCount), submenuCount: count(source.submenuCount), optionCount: count(source.optionCount), controls: Array.isArray(source.controls) ? source.controls.slice(0, 16).map((node) => shape(node || {})) : [] }
}

export function modelPopupDiagnosticSource() {
  return `const inspectModelPopup=${inspectModelPopup.toString()}; const normalizeModelPopupDiagnostic=${normalizeModelPopupDiagnostic.toString()}; const diagnosePopup=(menu,count=0)=>normalizeModelPopupDiagnostic(inspectModelPopup(document,trigger,menu,visible,excluded,count));`
}
