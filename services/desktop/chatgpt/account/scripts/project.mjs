import { accountScript, encode } from './prelude.mjs'
import { normalizeChatGPTProjectName } from '../naming.mjs'

// The authoritative remote project inventory: the "Move to project" submenu
// lists every project the account owns as an exact-named anchor. Reading it is
// what makes creation idempotent instead of duplicating a project per request.
export function chatGPTProjectInventoryScript() {
  return accountScript(`
    const anchors = [...document.querySelectorAll('a[role="menuitem"][href^="/g/g-p-"], a[href^="/g/g-p-"]')].filter((node) => visible(node));
    const seen = new Set();
    const projects = [];
    for (const anchor of anchors) {
      const href = String(anchor.getAttribute('href') || '');
      if (seen.has(href)) continue;
      seen.add(href);
      projects.push({ name: label(anchor), href });
    }
    return { ok: true, state: 'listed', projects: projects.slice(0, 200) };
  `)
}

export function chatGPTProjectItemRectScript(projectName) {
  const wanted = encode(normalizeChatGPTProjectName(projectName))
  return accountScript(`
    const fold = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const wanted = fold(${wanted});
    const anchors = [...document.querySelectorAll('a[role="menuitem"][href^="/g/g-p-"], a[href^="/g/g-p-"]')].filter((node) => visible(node));
    const matches = anchors.filter((node) => fold(label(node)) === wanted);
    if (!matches.length) return { ok: false, state: 'project-missing', count: anchors.length };
    const point = rect(matches[0]);
    if (!point) return { ok: false, state: 'project-offscreen', viewport: viewport() };
    return { ok: true, state: 'project-located', rect: point, duplicates: matches.length, href: matches[0].getAttribute('href') || '' };
  `)
}

export function chatGPTNewProjectDialogScript(projectName) {
  const wanted = encode(normalizeChatGPTProjectName(projectName))
  return accountScript(`
    const wanted = ${wanted};
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(visible);
    if (!dialog) return { ok: false, state: 'project-dialog-unavailable' };
    const input = [...dialog.querySelectorAll('input[type="text"], input:not([type]), input[name*="name" i]')].find((node) => usable(node) && visible(node));
    if (!input) return { ok: false, state: 'project-input-unavailable' };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, wanted); else input.value = wanted;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: wanted }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const submit = [...dialog.querySelectorAll('button[type="submit"], button[data-testid*="confirm"], button')].find((node) => usable(node) && visible(node) && /create|criar|crear|créer|erstellen/i.test(label(node)));
    if (!submit) return { ok: false, state: 'project-submit-unavailable' };
    const point = rect(submit);
    if (!point) return { ok: false, state: 'project-submit-offscreen', viewport: viewport() };
    return { ok: true, state: 'project-staged', rect: point, project: wanted };
  `)
}
