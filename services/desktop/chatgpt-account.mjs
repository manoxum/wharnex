function encode(value) {
  return JSON.stringify(String(value ?? ''))
}

export function normalizeWHXTitle(value) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim().replace(/^WHX:\s*/i, '')
  const title = compact.slice(0, 80) || 'New task'
  return `WHX: ${title}`
}

export function normalizeChatGPTProjectName(value) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim()
  if (!compact) return 'Wharnex'
  return compact.slice(0, 80)
}

// ChatGPT project names are compared case-insensitively and whitespace-folded
// before an exact match decides "exists" vs "create". Creating a second
// "Wharnex" next to an existing "wharnex" is the duplication this prevents.
export function sameChatGPTProjectName(left, right) {
  return normalizeChatGPTProjectName(left).toLocaleLowerCase() === normalizeChatGPTProjectName(right).toLocaleLowerCase()
}

// Shared prelude for every account script. `visible` rejects nodes that occupy
// no layout box; `rect` returns the viewport-relative centre a trusted native
// click must target, because ChatGPT's menu items are Radix `div[role=menuitem]`
// nodes that ignore synthetic HTMLElement.click() entirely.
const PRELUDE = `
    const visible = (node) => { const r = node?.getBoundingClientRect?.(); return Boolean(r && r.width > 0 && r.height > 0); };
    const usable = (node) => {
      if (!node || node.disabled || node.getAttribute?.('aria-disabled') === 'true' || node.hidden || node.closest?.('[hidden], [aria-hidden="true"], [inert]')) return false;
      const style = globalThis.getComputedStyle?.(node);
      return style?.display !== 'none' && style?.visibility !== 'hidden' && style?.visibility !== 'collapse';
    };
    const rect = (node) => {
      const r = node.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
      return { x, y, width: Math.round(r.width), height: Math.round(r.height) };
    };
    const label = (node) => String(node?.getAttribute?.('aria-label') || node?.getAttribute?.('title') || node?.textContent || '').replace(/\\s+/g, ' ').trim();
`

// Account-management scripts are deliberately separate from response transport.
// They may inspect only control metadata and exact user-owned names supplied by
// the trusted Wharnex renderer. They never inspect assistant messages.
export function chatGPTHideSidebarScript() {
  return `(() => {${PRELUDE}
    const sidebar = ['[data-testid="sidebar"]','nav[data-testid*="sidebar"]','aside[data-testid*="sidebar"]'].map((s) => document.querySelector(s)).find(visible);
    if (!sidebar) return { ok: true, state: 'hidden' };
    const controls = ['button[data-testid="close-sidebar-button"]','button[data-testid="sidebar-toggle-button"][aria-expanded="true"]','button[aria-controls*="sidebar"][aria-expanded="true"]'];
    const button = controls.map((s) => document.querySelector(s)).find((node) => node && !node.disabled && visible(node));
    if (!button) return { ok: false, state: 'unsupported' };
    button.click();
    return { ok: true, state: 'closing' };
  })()`
}

export function chatGPTShowSidebarScript() {
  return `(() => {${PRELUDE}
    const sidebar = ['[data-testid="sidebar"]','nav[data-testid*="sidebar"]','aside[data-testid*="sidebar"]'].map((s) => document.querySelector(s)).find(visible);
    if (sidebar) return { ok: true, state: 'visible' };
    const button = ['button[data-testid="open-sidebar-button"]','button[data-testid="sidebar-toggle-button"][aria-expanded="false"]','button[aria-controls*="sidebar"][aria-expanded="false"]'].map((s) => document.querySelector(s)).find((node) => node && !node.disabled && visible(node));
    if (!button) return { ok: false, state: 'sidebar-toggle-unavailable' };
    button.click();
    return { ok: true, state: 'opening' };
  })()`
}

export function chatGPTStopConversationScript() {
  return `(() => {${PRELUDE}
    const stop = [...document.querySelectorAll('button[data-testid="stop-button"], button[data-testid*="stop-button" i], button[aria-label*="stop generating" i], button[aria-label*="parar de gerar" i]')].find(usable);
    if (stop) {
      stop.click();
      return { ok: true, state: 'stopping' };
    }
    const composers = ['#prompt-textarea','div[contenteditable="true"][data-testid*="composer"]','div[contenteditable="true"][role="textbox"]','textarea[placeholder]'].flatMap((selector) => [...document.querySelectorAll(selector)]);
    return composers.some(usable) ? { ok: true, state: 'idle' } : { ok: false, state: 'surface-unavailable' };
  })()`
}

// The conversation options trigger is addressed by its own conversation id
// (`data-conversation-options-trigger`) so a sidebar reorder can never point the
// menu at a neighbouring conversation. The thread-header trigger is the fallback
// used when the conversation is open but not present in the visible history.
export function chatGPTOpenConversationMenuScript(conversationId = '') {
  const wanted = encode(conversationId)
  return `(() => {${PRELUDE}
    const id = ${wanted};
    // Attribute lookup by value rather than a CSS selector: conversation ids
    // start with a digit, and escaping them into a selector is a needless
    // failure mode when an exact string comparison is available.
    const owned = id ? [...document.querySelectorAll('[data-conversation-options-trigger]')].find((node) => node.getAttribute('data-conversation-options-trigger') === id) : null;
    const header = document.querySelector('button[data-testid="conversation-options-button"]');
    const trigger = [owned, header].find((node) => node && usable(node) && visible(node));
    if (!trigger) return { ok: false, state: 'menu-unavailable', boundToConversation: Boolean(owned) };
    trigger.click();
    return { ok: true, state: 'menu-opened', boundToConversation: trigger === owned };
  })()`
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
  return `(() => {${PRELUDE}
    const wanted = JSON.parse(${labels});
    const preferred = ${encode(testid)} ? document.querySelector('[role="menuitem"][data-testid=' + JSON.stringify(${encode(testid)}) + ']') : null;
    const items = [...document.querySelectorAll('[role="menuitem"]')].filter((node) => usable(node) && visible(node));
    if (!items.length) return { ok: false, state: 'menu-not-open' };
    const item = (preferred && items.includes(preferred) ? preferred : null)
      || items.find((node) => { const text = label(node).toLocaleLowerCase(); return wanted.some((value) => text === value); })
      || items.find((node) => { const text = label(node).toLocaleLowerCase(); return wanted.some((value) => text.startsWith(value)); });
    if (!item) return { ok: false, state: 'action-unavailable', available: items.map(label).slice(0, 12) };
    const point = rect(item);
    if (!point) return { ok: false, state: 'action-offscreen' };
    return { ok: true, state: 'action-located', rect: point, hasSubmenu: item.getAttribute('aria-haspopup') === 'menu' };
  })()`
}

// The authoritative remote project inventory: the "Move to project" submenu
// lists every project the account owns as an exact-named anchor. Reading it is
// what makes creation idempotent instead of duplicating a project per request.
export function chatGPTProjectInventoryScript() {
  return `(() => {${PRELUDE}
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
  })()`
}

export function chatGPTProjectItemRectScript(projectName) {
  const wanted = encode(normalizeChatGPTProjectName(projectName))
  return `(() => {${PRELUDE}
    const fold = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const wanted = fold(${wanted});
    const anchors = [...document.querySelectorAll('a[role="menuitem"][href^="/g/g-p-"], a[href^="/g/g-p-"]')].filter((node) => visible(node));
    const matches = anchors.filter((node) => fold(label(node)) === wanted);
    if (!matches.length) return { ok: false, state: 'project-missing', count: anchors.length };
    const point = rect(matches[0]);
    if (!point) return { ok: false, state: 'project-offscreen' };
    return { ok: true, state: 'project-located', rect: point, duplicates: matches.length, href: matches[0].getAttribute('href') || '' };
  })()`
}

// After a trusted click on "Rename" the sidebar row swaps its anchor for an
// inline `input[name="title-editor"]`. There is no rename dialog; the previous
// implementation waited for one that ChatGPT never renders.
export function chatGPTRenameEditorScript() {
  return `(() => {${PRELUDE}
    const input = [...document.querySelectorAll('input[name="title-editor"], input[aria-label="Chat title"]')].find((node) => usable(node) && visible(node));
    if (!input) return { ok: false, state: 'title-input-unavailable' };
    const point = rect(input);
    return { ok: true, state: 'title-input-ready', rect: point, length: String(input.value || '').length };
  })()`
}

export function chatGPTCommitConversationTitleScript(title) {
  const wanted = encode(normalizeWHXTitle(title))
  return `(() => {${PRELUDE}
    const value = ${wanted};
    const input = [...document.querySelectorAll('input[name="title-editor"], input[aria-label="Chat title"]')].find((node) => usable(node) && visible(node));
    if (!input) return { ok: false, state: 'title-input-unavailable' };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    input.focus();
    input.select?.();
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const point = rect(input);
    return { ok: true, state: 'title-staged', rect: point, title: value };
  })()`
}

// Confirms the rename landed by reading the conversation's own row label — a
// user-owned title, never assistant prose.
export function chatGPTConversationTitleScript(conversationId = '') {
  const wanted = encode(conversationId)
  return `(() => {${PRELUDE}
    const id = ${wanted};
    if (!document.querySelector('input[name="title-editor"], input[aria-label="Chat title"]')) {
      const anchor = id ? [...document.querySelectorAll('a[href^="/c/"]')].find((node) => node.getAttribute('href') === '/c/' + id) : null;
      const title = anchor ? String(anchor.getAttribute('aria-label') || '').trim() : '';
      return { ok: true, state: 'committed', title };
    }
    return { ok: false, state: 'still-editing' };
  })()`
}

export function chatGPTNewProjectDialogScript(projectName) {
  const wanted = encode(normalizeChatGPTProjectName(projectName))
  return `(() => {${PRELUDE}
    const wanted = ${wanted};
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(visible);
    if (!dialog) return { ok: false, state: 'project-dialog-unavailable' };
    const input = [...dialog.querySelectorAll('input[type="text"], input:not([type]), input[name*="name" i]')].find((node) => usable(node) && visible(node));
    if (!input) return { ok: false, state: 'project-input-unavailable' };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    input.focus();
    if (setter) setter.call(input, wanted); else input.value = wanted;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: wanted }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const submit = [...dialog.querySelectorAll('button[type="submit"], button[data-testid*="confirm"], button')].find((node) => usable(node) && visible(node) && /create|criar|crear|créer|erstellen/i.test(label(node)));
    if (!submit) return { ok: false, state: 'project-submit-unavailable' };
    const point = rect(submit);
    if (!point) return { ok: false, state: 'project-submit-offscreen' };
    return { ok: true, state: 'project-staged', rect: point, project: wanted };
  })()`
}



// Finds one Library artifact by exact provider id and/or exact canonical
// filename. The action button's aria-label is control metadata, not generated
// content. Ambiguous matches fail closed; fuzzy/truncated labels never match.
export function chatGPTLibraryArtifactRectScript(canonicalFilename, artifactId = '') {
  const wantedName = encode(String(canonicalFilename || '').trim())
  const wantedID = encode(String(artifactId || '').trim())
  return `(() => {${PRELUDE}
    const wantedName = ${wantedName};
    const wantedID = ${wantedID};
    const rows = [...document.querySelectorAll('div[role="row"][data-page-table-selection-id]')].filter(visible);
    const parseName = (button) => {
      const raw = String(button?.getAttribute?.('aria-label') || '').trim();
      const prefix = 'Open actions menu for ';
      return raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : '';
    };
    const matches = [];
    for (const row of rows) {
      const id = String(row.getAttribute('data-page-table-selection-id') || '').trim();
      const action = [...row.querySelectorAll('button[aria-label^="Open actions menu for "]')].find((node) => usable(node) && visible(node));
      if (!action) continue;
      const name = parseName(action);
      const idOK = !wantedID || id === wantedID;
      const nameOK = !wantedName || name === wantedName;
      if (idOK && nameOK) matches.push({ row, action, id, name });
    }
    if (!matches.length) return { ok: false, state: 'artifact-missing', rows: rows.length };
    if (matches.length !== 1) return { ok: false, state: 'artifact-ambiguous', matches: matches.length };
    const point = rect(matches[0].action);
    return point ? { ok: true, state: 'artifact-located', rect: point, artifactId: matches[0].id, canonicalFilename: matches[0].name }
      : { ok: false, state: 'artifact-offscreen' };
  })()`
}

export function chatGPTLibraryArtifactStateScript(canonicalFilename, artifactId = '') {
  const wantedName = encode(String(canonicalFilename || '').trim())
  const wantedID = encode(String(artifactId || '').trim())
  return `(() => {${PRELUDE}
    const wantedName = ${wantedName};
    const wantedID = ${wantedID};
    const rows = [...document.querySelectorAll('div[role="row"][data-page-table-selection-id]')].filter(visible);
    const names = rows.map((row) => {
      const button = row.querySelector('button[aria-label^="Open actions menu for "]');
      const raw = String(button?.getAttribute?.('aria-label') || '').trim();
      const prefix = 'Open actions menu for ';
      return { id: String(row.getAttribute('data-page-table-selection-id') || '').trim(), name: raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : '' };
    });
    const matches = names.filter((item) => (!wantedID || item.id === wantedID) && (!wantedName || item.name === wantedName));
    return { ok: true, state: matches.length ? 'artifact-present' : 'artifact-absent', matches: matches.length, rows: rows.length };
  })()`
}

// Confirms a destructive action only inside ChatGPT's visible confirmation
// dialog. The caller must first address the exact conversation menu by id.
export function chatGPTConfirmDeleteScript() {
  return `(() => {${PRELUDE}
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(visible);
    if (!dialog) return { ok: false, state: 'delete-dialog-unavailable' };
    const buttons = [...dialog.querySelectorAll('button')].filter((node) => usable(node) && visible(node));
    const wanted = ['delete','apagar','eliminar','supprimer','löschen'];
    const button = buttons.find((node) => wanted.some((value) => label(node).toLocaleLowerCase() === value))
      || buttons.find((node) => wanted.some((value) => label(node).toLocaleLowerCase().startsWith(value)));
    if (!button) return { ok: false, state: 'delete-confirm-unavailable', available: buttons.map(label).slice(0, 8) };
    const point = rect(button);
    return point ? { ok: true, state: 'delete-confirm-located', rect: point } : { ok: false, state: 'delete-confirm-offscreen' };
  })()`
}
