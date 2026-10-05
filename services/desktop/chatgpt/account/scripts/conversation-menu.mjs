import { accountScript, encode } from './prelude.mjs'
import { normalizeWHXTitle } from '../naming.mjs'

// The conversation options trigger is addressed by its own conversation id
// (`data-conversation-options-trigger`) so a sidebar reorder can never point the
// menu at a neighbouring conversation. When the exact requested conversation is
// already loaded, its thread-header trigger is preferred: unlike the virtualized
// history row it cannot drift to a recycled `history-item-N`/`undefined-options`
// control while the sidebar list reconciles.
export function chatGPTOpenConversationMenuScript(conversationId = '') {
  const wanted = encode(conversationId)
  return accountScript(`
    const id = ${wanted};
    // Attribute lookup by value rather than a CSS selector: conversation ids
    // start with a digit, and escaping them into a selector is a needless
    // failure mode when an exact string comparison is available.
    const owned = id ? [...document.querySelectorAll('[data-conversation-options-trigger]')].find((node) => node.getAttribute('data-conversation-options-trigger') === id) : null;
    const header = document.querySelector('button[data-testid="conversation-options-button"]');
    const current = String(location.pathname || '').match(/\\/c\\/([^/?#]+)/)?.[1] || '';
    const exactHeader = id && current === id ? header : null;
    const trigger = [exactHeader, owned].find((node) => node && usable(node) && visible(node));
    if (!trigger) return { ok: false, state: 'menu-unavailable', boundToConversation: false };
    const point = rect(trigger);
    if (!point) return { ok: false, state: 'menu-offscreen', viewport: viewport(), boundToConversation: true };
    return { ok: true, state: 'menu-opened', rect: point, boundToConversation: true, source: trigger === exactHeader ? 'header' : 'history' };
  `)
}

const ACTION_LABELS = {
  rename: ['rename', 'renomear', 'cambiar nombre', 'renommer', 'umbenennen'],
  archive: ['archive', 'arquivar', 'archivar', 'archiver', 'archivieren'],
  delete: ['delete', 'apagar', 'eliminar', 'supprimer', 'löschen'],
  'move-project': ['move to project', 'mover para projeto', 'mover para o projeto', 'mover al proyecto', 'déplacer vers le projet', 'in projekt verschieben'],
  'new-project': ['new project', 'novo projeto', 'nuevo proyecto', 'nouveau projet', 'neues projekt'],
}

// Returns the click target instead of clicking: ChatGPT's Radix menu items only
// honour a trusted native mouse event, so the main process performs the click.
export function chatGPTMenuItemRectScript(action) {
  const labels = encode(JSON.stringify(ACTION_LABELS[action] || []))
  const testid = action === 'archive' ? 'archive-chat-menu-item' : action === 'rename' ? 'rename-chat-menu-item' : action === 'delete' ? 'delete-chat-menu-item' : ''
  return accountScript(`
    const wanted = JSON.parse(${labels});
    const preferredRaw = ${encode(testid)} ? document.querySelector('[data-testid=' + JSON.stringify(${encode(testid)}) + ']') : null;
    const preferred = preferredRaw?.closest?.('[role="menuitem"], button') || preferredRaw;
    const candidates = [...document.querySelectorAll('[role="menuitem"]')];
    const items = candidates.filter((node) => usable(node) && visible(node));
    if (!items.length && !(preferred && usable(preferred) && visible(preferred))) {
      return { ok: false, state: 'menu-not-open', rows: candidates.length, matches: preferredRaw ? 1 : 0, viewport: viewport() };
    }
    const item = (preferred && usable(preferred) && visible(preferred) ? preferred : null)
      || items.find((node) => { const text = label(node).toLocaleLowerCase(); return wanted.some((value) => text === value); })
      || items.find((node) => { const text = label(node).toLocaleLowerCase(); return wanted.some((value) => text.startsWith(value)); });
    if (!item) return { ok: false, state: 'action-unavailable', available: items.map(label).slice(0, 12) };
    const point = rect(item);
    if (!point) return { ok: false, state: 'action-offscreen', viewport: viewport() };
    return { ok: true, state: 'action-located', rect: point, hasSubmenu: item.getAttribute('aria-haspopup') === 'menu' };
  `)
}

// After a trusted click on "Rename" the sidebar row swaps its anchor for an
// inline `input[name="title-editor"]`. There is no rename dialog; the previous
// implementation waited for one that ChatGPT never renders.
export function chatGPTRenameEditorScript() {
  return accountScript(`
    const input = [...document.querySelectorAll('input[name="title-editor"], input[aria-label="Chat title"]')].find((node) => usable(node) && visible(node));
    if (!input) return { ok: false, state: 'title-input-unavailable' };
    const point = rect(input);
    return { ok: true, state: 'title-input-ready', rect: point, length: String(input.value || '').length };
  `)
}

export function chatGPTCommitConversationTitleScript(title) {
  const wanted = encode(normalizeWHXTitle(title))
  return accountScript(`
    const value = ${wanted};
    const input = [...document.querySelectorAll('input[name="title-editor"], input[aria-label="Chat title"]')].find((node) => usable(node) && visible(node));
    if (!input) return { ok: false, state: 'title-input-unavailable' };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const point = rect(input);
    return { ok: true, state: 'title-staged', rect: point, title: value };
  `)
}

// Confirms the rename landed by reading the conversation's own row label — a
// user-owned title, never assistant prose.
export function chatGPTConversationTitleScript(conversationId = '') {
  const wanted = encode(conversationId)
  return accountScript(`
    const id = ${wanted};
    if (!document.querySelector('input[name="title-editor"], input[aria-label="Chat title"]')) {
      const anchor = id ? [...document.querySelectorAll('a[href^="/c/"]')].find((node) => node.getAttribute('href') === '/c/' + id) : null;
      const title = anchor ? String(anchor.getAttribute('aria-label') || '').trim() : '';
      return { ok: true, state: 'committed', title };
    }
    return { ok: false, state: 'still-editing' };
  `)
}
