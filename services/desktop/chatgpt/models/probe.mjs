import { modelControlLookupSource } from './controls.mjs'

// Passive diagnostic of model chrome. It never opens the menu, and follows only
// the model trigger's explicit aria-controls relation to the owned popup.
export const MODEL_PICKER_PROBE = `
  ${modelControlLookupSource()}
  let triggers = [];
  for (const selector of modelSelectors) { triggers = [...document.querySelectorAll(selector)].filter((node) => visible(node) && modelControlMatches(selector,node)); if (triggers.length) break; }
  const trigger = triggers.length === 1 ? triggers[0] : null;
  const popupId = trigger?.getAttribute('aria-controls');
  const menu = popupId ? document.getElementById(popupId) : null;
  const options = menu && visible(menu) ? [...menu.querySelectorAll('[role="menuitemradio"],[role="option"],[data-model-id]')].filter(visible) : [];
  const modelLabel = (node) => {
    const named = node.getAttribute('aria-label') || node.getAttribute('data-model-name');
    if (named) return String(named).slice(0,120);
    const leaves = [node,...node.querySelectorAll('*')].slice(0,64).filter((child) => visible(child) && !['SVG','PATH'].includes(child.tagName) && !child.children.length);
    return String(leaves.find((child) => String(child.textContent || '').trim())?.textContent || '').replace(/\\s+/g,' ').trim().slice(0,120);
  };
  return { control:'model-picker',viewport:viewport(),triggers:triggers.length,linkedMenus:menu ? 1 : 0,options:options.length,
    labels:options.slice(0,16).map((node) => ({ label:modelLabel(node),role:node.getAttribute('role') || '',disabled:node.disabled || node.getAttribute('aria-disabled')==='true' || node.hasAttribute('data-disabled'),selected:node.getAttribute('aria-checked')==='true' || node.getAttribute('aria-selected')==='true' || node.getAttribute('data-state')==='checked' })) };
`
