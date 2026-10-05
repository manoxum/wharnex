import { accountScript } from './prelude.mjs'

// Account-management scripts are deliberately separate from response transport.
// They may inspect only control metadata and exact user-owned names supplied by
// the trusted Wharnex renderer. They never inspect assistant messages.
export function chatGPTHideSidebarScript() {
  return accountScript(`
    const sidebar = ['[data-testid="sidebar"]','nav[data-testid*="sidebar"]','aside[data-testid*="sidebar"]'].map((s) => document.querySelector(s)).find(visible);
    if (!sidebar) return { ok: true, state: 'hidden' };
    const controls = ['button[data-testid="close-sidebar-button"]','button[data-testid="sidebar-toggle-button"][aria-expanded="true"]','button[aria-controls*="sidebar"][aria-expanded="true"]'];
    const button = controls.map((s) => document.querySelector(s)).find((node) => node && !node.disabled && visible(node));
    if (!button) return { ok: false, state: 'unsupported' };
    const point = rect(button);
    if (!point) return { ok: false, state: 'sidebar-toggle-offscreen', viewport: viewport() };
    return { ok: true, state: 'closing', rect: point };
  `)
}

export function chatGPTShowSidebarScript() {
  return accountScript(`
    const sidebar = ['[data-testid="sidebar"]','nav[data-testid*="sidebar"]','aside[data-testid*="sidebar"]'].map((s) => document.querySelector(s)).find(visible);
    if (sidebar) return { ok: true, state: 'visible' };
    const button = ['button[data-testid="open-sidebar-button"]','button[data-testid="sidebar-toggle-button"][aria-expanded="false"]','button[aria-controls*="sidebar"][aria-expanded="false"]'].map((s) => document.querySelector(s)).find((node) => node && !node.disabled && visible(node));
    if (!button) return { ok: false, state: 'sidebar-toggle-unavailable' };
    const point = rect(button);
    if (!point) return { ok: false, state: 'sidebar-toggle-offscreen', viewport: viewport() };
    return { ok: true, state: 'opening', rect: point };
  `)
}

export function chatGPTStopConversationScript() {
  return accountScript(`
    const stop = [...document.querySelectorAll('button[data-testid="stop-button"], button[data-testid*="stop-button" i], button[aria-label*="stop generating" i], button[aria-label*="parar de gerar" i]')].find(usable);
    if (stop) {
      const point = rect(stop);
      if (!point) return { ok: false, state: 'stop-offscreen', viewport: viewport() };
      return { ok: true, state: 'stopping', rect: point };
    }
    const composers = ['#prompt-textarea','div[contenteditable="true"][data-testid*="composer"]','div[contenteditable="true"][role="textbox"]','textarea[placeholder]'].flatMap((selector) => [...document.querySelectorAll(selector)]);
    return composers.some(usable) ? { ok: true, state: 'idle' } : { ok: false, state: 'surface-unavailable' };
  `)
}
