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

// Account-management scripts are deliberately separate from response transport.
// They may inspect only control metadata and exact user-owned names supplied by
// the trusted Wharnex renderer. They never inspect assistant messages.
export function chatGPTHideSidebarScript() {
  return `(() => {
    const visible = (node) => { const r = node?.getBoundingClientRect?.(); return Boolean(r && r.width > 0 && r.height > 0); };
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
  return `(() => {
    const visible = (node) => { const r = node?.getBoundingClientRect?.(); return Boolean(r && r.width > 0 && r.height > 0); };
    const sidebar = ['[data-testid="sidebar"]','nav[data-testid*="sidebar"]','aside[data-testid*="sidebar"]'].map((s) => document.querySelector(s)).find(visible);
    if (sidebar) return { ok: true, state: 'visible' };
    const button = ['button[data-testid="open-sidebar-button"]','button[data-testid="sidebar-toggle-button"][aria-expanded="false"]','button[aria-controls*="sidebar"][aria-expanded="false"]'].map((s) => document.querySelector(s)).find((node) => node && !node.disabled && visible(node));
    if (!button) return { ok: false, state: 'sidebar-toggle-unavailable' };
    button.click();
    return { ok: true, state: 'opening' };
  })()`
}

export function chatGPTStopConversationScript() {
  return `(() => {
    const button = document.querySelector('button[data-testid="stop-button"]');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return { ok: true, state: 'idle' };
    button.click();
    return { ok: true, state: 'stopping' };
  })()`
}

function conversationMenuScript(action) {
  const wanted = encode(action)
  return `(() => {
    const action = ${wanted};
    const visible = (node) => { const r = node?.getBoundingClientRect?.(); return Boolean(r && r.width > 0 && r.height > 0); };
    const labels = new Set(['conversation options','chat options','opções da conversa','opções do chat','opciones de la conversación','options de la conversation','konversationsoptionen']);
    const menu = ['button[data-testid="conversation-options-button"]','button[data-testid*="conversation-menu"]'].map((s) => document.querySelector(s)).find((node) => node && visible(node))
      || [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((node) => visible(node) && labels.has(String(node.getAttribute('aria-label') || node.getAttribute('title') || '').trim().toLowerCase()));
    if (!menu) return { ok: false, state: 'menu-unavailable' };
    menu.click();
    return { ok: true, state: 'menu-opened', action };
  })()`
}

export function chatGPTOpenConversationMenuScript(action) {
  return conversationMenuScript(action)
}

export function chatGPTChooseConversationActionScript(action) {
  const wanted = encode(action)
  return `(() => {
    const action = ${wanted};
    const visible = (node) => { const r = node?.getBoundingClientRect?.(); return Boolean(r && r.width > 0 && r.height > 0); };
    const selectors = action === 'rename'
      ? ['[role="menuitem"][data-testid*="rename"]','button[data-testid*="rename-conversation"]']
      : action === 'archive'
        ? ['[role="menuitem"][data-testid*="archive"]','button[data-testid*="archive-conversation"]']
        : ['[role="menuitem"][data-testid*="move-project"]','button[data-testid*="move-project"]'];
    const labels = action === 'rename'
      ? new Set(['rename','renomear','cambiar nombre','renommer','umbenennen'])
      : action === 'archive'
        ? new Set(['archive','arquivar','archivar','archiver','archivieren'])
        : new Set(['move to project','mover para projeto','mover al proyecto','déplacer vers le projet','in projekt verschieben']);
    const item = selectors.map((s) => document.querySelector(s)).find((node) => node && visible(node))
      || [...document.querySelectorAll('[role="menuitem"],button[role="menuitem"]')].find((node) => visible(node) && labels.has(String(node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').trim().toLowerCase()));
    if (!item) return { ok: false, state: 'action-unavailable' };
    item.click();
    return { ok: true, state: 'action-selected' };
  })()`
}

export function chatGPTCommitConversationTitleScript(title) {
  const wanted = encode(normalizeWHXTitle(title))
  return `(() => {
    const value = ${wanted};
    const dialog = document.querySelector('[role="dialog"]');
    const input = dialog?.querySelector('input[data-testid*="title"],input[name="title"],input[type="text"]');
    if (!input) return { ok: false, state: 'title-input-unavailable' };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const submit = dialog.querySelector('button[type="submit"],button[data-testid*="confirm"]');
    if (!submit || submit.disabled) return { ok: false, state: 'title-submit-unavailable' };
    submit.click();
    return { ok: true, state: 'renamed', title: value };
  })()`
}

export function chatGPTSelectProjectScript(projectName) {
  const wanted = encode(normalizeChatGPTProjectName(projectName))
  return `(() => {
    const wanted = ${wanted};
    const dialog = document.querySelector('[role="dialog"],[role="menu"]');
    if (!dialog) return { ok: false, state: 'project-picker-unavailable' };
    const candidates = [...dialog.querySelectorAll('[data-testid*="project"],[role="menuitem"],[role="option"]')];
    const item = candidates.find((node) => String(node.getAttribute('data-project-name') || node.getAttribute('aria-label') || node.textContent || '').trim() === wanted);
    if (!item) return { ok: false, state: 'project-missing' };
    item.click();
    return { ok: true, state: 'project-selected', project: wanted };
  })()`
}

export function chatGPTFindProjectScript(projectName) {
  const wanted = encode(normalizeChatGPTProjectName(projectName))
  return `(() => {
    const wanted = ${wanted};
    const links = [...document.querySelectorAll('a[href*="/g/g-p-"][data-testid*="project"],a[href*="/project"]')];
    const match = links.find((node) => String(node.getAttribute('data-project-name') || node.getAttribute('aria-label') || node.textContent || '').trim() === wanted);
    return match ? { ok: true, state: 'exists' } : { ok: false, state: 'missing' };
  })()`
}

export function chatGPTCreateProjectScript(projectName) {
  const wanted = encode(normalizeChatGPTProjectName(projectName))
  return `(() => {
    const wanted = ${wanted};
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      const input = dialog.querySelector('input[data-testid*="project"],input[name="name"],input[type="text"]');
      if (!input) return { ok: false, state: 'project-input-unavailable' };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(input, wanted); else input.value = wanted;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: wanted }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const submit = dialog.querySelector('button[type="submit"],button[data-testid*="confirm"]');
      if (!submit || submit.disabled) return { ok: false, state: 'project-submit-unavailable' };
      submit.click();
      return { ok: true, state: 'created', project: wanted };
    }
    const labels = new Set(['new project','create project','novo projeto','criar projeto','nuevo proyecto','crear proyecto','nouveau projet','créer un projet','neues projekt','projekt erstellen']);
    const create = ['button[data-testid="create-project-button"]','button[data-testid*="new-project"]'].map((s) => document.querySelector(s)).find(Boolean)
      || [...document.querySelectorAll('button')].find((node) => labels.has(String(node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').trim().toLowerCase()));
    if (!create) return { ok: false, state: 'create-project-unavailable' };
    create.click();
    return { ok: true, state: 'create-dialog-opened' };
  })()`
}
