// Live-maintained ChatGPT DOM map. This is separate from behavior validation
// so a provider rollout touches one small, reviewable module.
export const CHATGPT_DOM_BEHAVIOR_REVISION = '2026-10-08.1'

export const CHATGPT_REQUIRED_SELECTORS = Object.freeze({
  composer: ['#prompt-textarea', 'div[contenteditable="true"][role="textbox"]', 'textarea[name="prompt-textarea"]'],
  sendButton: ['button[data-testid="send-button"]'],
  stopButton: ['button[data-testid="stop-button"]', 'button:has(svg.icon-primary-action path[d^="M4.5 5.75"])'],
  assistantTurn: ['[data-message-author-role="assistant"]'],
  conversationTurn: ['[data-testid^="conversation-turn"]'],
  sidebarRoot: ['[data-testid="sidebar"]', 'nav[data-testid*="sidebar"]', 'aside[data-testid*="sidebar"]'],
  sidebarClose: ['button[data-testid="close-sidebar-button"]'],
  sidebarOpen: ['button[data-testid="open-sidebar-button"]'],
  conversationAnchor: ['a[href^="/c/"]'],
  conversationOptionsTrigger: ['[data-conversation-options-trigger]'],
  conversationOptionsHeader: ['button[data-testid="conversation-options-button"]'],
  menuItem: ['[role="menuitem"]'],
  projectAnchor: ['a[role="menuitem"][href^="/g/g-p-"]', 'a[href^="/g/g-p-"]'],
  titleEditor: ['input[name="title-editor"]', 'input[aria-label="Chat title"]'],
  dialog: ['[role="dialog"]'],
  libraryRow: ['div[role="row"][data-page-table-selection-id]'],
  libraryRowActions: ['button[aria-label^="Open actions menu for "]'],
  errorNotice: ['[data-testid*="error" i]', 'div[role="alert"]'],
})

const COMPOSER_POPUP = [
  '[data-composer-surface] button[aria-haspopup="menu"]:not([data-testid])',
  'form[data-chatgpt-composer] button[aria-haspopup="menu"]:not([data-testid])',
]

export const CHATGPT_OPTIONAL_SELECTORS = Object.freeze({
  modelPicker: COMPOSER_POPUP,
  modelOption: ['[role="menuitemradio"]'],
  effortPicker: COMPOSER_POPUP,
  effortSlider: ['[data-model-reasoning-effort-slider] [role="slider"]', '[role="slider"][aria-valuenow]'],
  reasoningDisclosure: ['button[aria-expanded]'],
  reasoningRow: ['[data-reasoning-row]'],
})

export const CHATGPT_EFFORT_LEVELS = Object.freeze([
  { id: 'instant', labels: ['instantâneo', 'instantaneo', 'instant'] },
  { id: 'medium', labels: ['médio', 'medio', 'medium', 'standard'] },
  { id: 'high', labels: ['elevada', 'elevado', 'high', 'alta'] },
])
