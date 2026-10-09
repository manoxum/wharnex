import { modelControlLookupSource } from './controls.mjs'
import { modelPopupDiagnosticSource } from './popup-diagnostic.mjs'

// Constant, named model-control operations. No renderer string reaches the page;
// a selection uses only the bounded index resolved from a fresh inventory.
const PRELUDE = `
  const visible = (node) => { const r = node?.getBoundingClientRect?.(); const s = node && getComputedStyle(node); return Boolean(r?.width > 0 && r?.height > 0 && !node.closest('[hidden],[aria-hidden="true"],[inert]') && s.display !== 'none' && s.visibility !== 'hidden'); };
  const excluded = (node) => Boolean(node.closest('[data-message-author-role],[data-testid^="conversation-turn"],[data-chatgpt-agent-turn-start],.markdown,pre,code'));
  ${modelControlLookupSource()}
  let buttons = [];
  for (const selector of modelSelectors) { buttons = [...document.querySelectorAll(selector)].filter((node) => visible(node) && !excluded(node) && modelControlMatches(selector,node)); if (buttons.length) break; }
  if (buttons.length !== 1) return { ok: false, state: buttons.length ? 'model-control-ambiguous' : 'model-control-unavailable' };
  const trigger = buttons[0];
  if (trigger.disabled || trigger.getAttribute('aria-disabled') === 'true') return { ok: false, state: 'model-control-disabled' };
  const point = (node) => { const r = node.getBoundingClientRect(); const x = Math.round(r.left+r.width/2), y = Math.round(r.top+r.height/2); return x>=0 && y>=0 && x<innerWidth && y<innerHeight ? {x,y} : null; };
  ${modelPopupDiagnosticSource()}
  const expanded = trigger.getAttribute('aria-expanded') === 'true' || trigger.getAttribute('data-state') === 'open';
  if (!expanded) return { ok: true, state: 'model-menu-closed', rect: point(trigger),diagnostic:diagnosePopup(null) };
  const controlled = trigger.getAttribute('aria-controls');
  const owned = controlled ? document.getElementById(controlled) : null;
  const menus = owned ? [owned] : [...document.querySelectorAll('[role="menu"],[role="listbox"]')].filter((node) => visible(node) && node.getAttribute('aria-labelledby') === trigger.id);
  if (menus.length !== 1 || !visible(menus[0]) || excluded(menus[0])) return { ok: false, state: 'model-menu-unavailable',diagnostic:diagnosePopup(null) };
  const rows = [...menus[0].querySelectorAll('[role="menuitemradio"],[role="option"],[data-model-id]')].filter((node) => visible(node) && !excluded(node));
  if (!rows.length || rows.length > 32) return { ok: false, state: 'model-options-unavailable',diagnostic:diagnosePopup(menus[0],rows.length) };
  const label = (node) => {
    const named = node.getAttribute('aria-label') || node.getAttribute('data-model-name');
    if (named) return named.replace(/\\s+/g,' ').trim().slice(0,120);
    const leaves = [node,...node.querySelectorAll('*')].slice(0,64).filter((child) => visible(child) && !['SVG','PATH'].includes(child.tagName) && !child.children.length);
    return String(leaves.find((child) => String(child.textContent || '').trim())?.textContent || '').replace(/\\s+/g,' ').trim().slice(0,120);
  };
  const options = rows.map((node,index) => ({ index, id: String(node.getAttribute('data-model-id') || label(node)).slice(0,120), label: label(node), disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true' || node.hasAttribute('data-disabled')), selected: node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-selected') === 'true' || node.getAttribute('data-state') === 'checked' }));
  if (options.some((option) => !option.id || !option.label)) return { ok: false, state: 'model-label-unavailable' };
`

export function modelInventoryScript() {
  return `(() => { ${PRELUDE} return { ok:true,state:'model-menu-read',options }; })()`
}

export function modelOptionScript(index) {
  if (!Number.isInteger(index) || index < 0 || index > 31) throw new Error('Invalid model option index')
  return `(() => { ${PRELUDE} const chosen=options[${index}]; if (!chosen || chosen.disabled) return {ok:false,state:'model-option-unavailable'}; return {ok:true,state:'model-option-ready',rect:point(rows[${index}]),option:chosen}; })()`
}
