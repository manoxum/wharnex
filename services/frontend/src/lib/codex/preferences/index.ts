import type { PlannerChatConfiguration } from '../contracts'

const KEY = 'wharnex.codex.preferences.v1'
type Preferences = { model: string; efforts: Record<string, string> }
const valid = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max

function load(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!value || !valid(value.model, 160)) return { model: '', efforts: {} }
    const entries = Object.entries(value.efforts || {}).filter((entry): entry is [string, string] => valid(entry[0], 160) && valid(entry[1], 40)).slice(-32)
    return { model: value.model, efforts: Object.fromEntries(entries) }
  } catch { return { model: '', efforts: {} } }
}

export function resolveCodexSelection(chat: PlannerChatConfiguration = {}) {
  const preferences = load()
  const codexModel = chat.codexModel ?? preferences.model
  return { codexModel, codexEffort: chat.codexEffort ?? (Object.hasOwn(preferences.efforts, codexModel) ? preferences.efforts[codexModel] : '') }
}

export function rememberCodexSelection(codexModel: string, codexEffort: string) {
  const preferences = load()
  const efforts = Object.fromEntries([...Object.entries(preferences.efforts).filter(([model]) => model !== codexModel), [codexModel, codexEffort]].slice(-32))
  try { localStorage.setItem(KEY, JSON.stringify({ model: codexModel, efforts })) } catch { /* Chat persistence still retains explicit choices. */ }
}

export function createCodexComposerControls(chat: PlannerChatConfiguration | undefined, disabled: boolean, engineDisabled: boolean, update: (patch: PlannerChatConfiguration) => void) {
  const selection = resolveCodexSelection(chat)
  return {
    engine: chat?.engine || 'chatgpt' as const, ...selection, codexPermission: chat?.codexPermission,
    onEngine: (engine: NonNullable<PlannerChatConfiguration['engine']>) => {
      if (!engineDisabled) update(engine === 'codex' ? { engine, ...selection } : { engine })
    },
    onCodexModel: (codexModel: string) => {
      if (disabled) return
      rememberCodexSelection(selection.codexModel, selection.codexEffort)
      const codexEffort = resolveCodexSelection({ codexModel }).codexEffort
      rememberCodexSelection(codexModel, codexEffort)
      update({ codexModel, codexEffort })
    },
    onCodexEffort: (codexEffort: string) => {
      if (disabled) return
      rememberCodexSelection(selection.codexModel, codexEffort)
      update({ codexModel: selection.codexModel, codexEffort })
    },
    onCodexPermission: (codexPermission: NonNullable<PlannerChatConfiguration['codexPermission']>) => { if (!disabled) update({ codexPermission }) },
  }
}
