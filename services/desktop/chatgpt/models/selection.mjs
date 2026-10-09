import { withOwnedChatGPTPageInput } from '../account/control/index.mjs'
import { modelInventoryScript, modelOptionScript } from './scripts.mjs'

const failure = (detail) => Object.assign(new Error(`Modelo ChatGPT indisponível: ${detail}. Abra o Engine e confirme o controlo de modelos.`), { retryTransport: false, code: 'WHARNEX_CHATGPT_MODEL_UNAVAILABLE', state: detail })
export function normalizeModelInventory(raw) {
  if (!raw?.ok || raw.state !== 'model-menu-read' || !Array.isArray(raw.options) || !raw.options.length || raw.options.length > 32) throw failure(String(raw?.state || 'model-options-unavailable').slice(0, 80))
  const options = raw.options.map((row, index) => ({ id: String(row.id || '').trim().slice(0, 120), label: String(row.label || '').trim().slice(0, 120), disabled: row.disabled === true, selected: row.selected === true, index }))
  if (options.some((row) => !row.id || !row.label) || new Set(options.map((row) => row.id)).size !== options.length) throw failure('model-options-ambiguous')
  const selected = options.filter((row) => row.selected)
  if (selected.length > 1) throw failure('model-selection-ambiguous')
  return { ok: true, current: selected[0]?.id || '', options }
}
const publicInventory = (snapshot) => ({ ok: true, current: snapshot.current, options: snapshot.options.map(({ id, label, disabled }) => ({ id, label, disabled })) })

export function createChatGPTModelSelection(context) {
  const { executeChatGPTDOMScript, requireOwnedChatGPTEntry, pressChatGPTControl, pressChatGPTControlKey, wait } = context
  const observe = (key, entry, stage = 'model-inventory') => executeChatGPTDOMScript(key, entry, stage, modelInventoryScript())
  async function readInventory(key, entry, { keepOpen = false } = {}) {
    let retained = false
    let menuOwned = false
    try {
      let raw = await observe(key, entry, 'model-open')
      menuOwned = raw?.ok && raw.state === 'model-menu-read'
      if (raw?.ok && raw.state === 'model-menu-closed') {
        if (!raw.rect) throw failure('model-control-offscreen')
        const { wc } = requireOwnedChatGPTEntry(key, entry)
        await pressChatGPTControl(entry, wc, raw.rect)
        menuOwned = true
        await wait(180)
        raw = await observe(key, entry)
      }
      const result = normalizeModelInventory(raw)
      if (keepOpen) { retained = true; return result }
      return publicInventory(result)
    } finally {
      if (menuOwned && !retained) {
        const { wc } = requireOwnedChatGPTEntry(key, entry)
        await pressChatGPTControlKey(entry, wc, 'Escape')
      }
    }
  }
  async function selectOwned(key, entry, model) {
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    let menuOwned = false
    try {
      const snapshot = await readInventory(key, entry, { keepOpen: true })
      menuOwned = true
      const choice = snapshot.options.find((row) => row.id === model)
      if (!choice || choice.disabled) throw failure('model-option-unavailable')
      if (snapshot.current === model) return publicInventory(snapshot)
      const target = await executeChatGPTDOMScript(key, entry, 'model-locate', modelOptionScript(choice.index))
      // Refuse a menu reordered between inventory and native commit.
      if (!target?.ok || !target.rect || target.option?.id !== choice.id || target.option?.disabled === true) throw failure('model-option-changed')
      requireOwnedChatGPTEntry(key, entry)
      await pressChatGPTControl(entry, wc, target.rect)
      await wait(180)
      const confirmed = await readInventory(key, entry)
      menuOwned = false
      if (confirmed.current !== model) throw failure('model-selection-unconfirmed')
      return confirmed
    } finally {
      if (menuOwned) {
        requireOwnedChatGPTEntry(key, entry)
        await pressChatGPTControlKey(entry, wc, 'Escape')
      }
    }
  }
  const withInput = (key, entry, action) => withOwnedChatGPTPageInput(entry, requireOwnedChatGPTEntry(key, entry).wc, action)
  const inventory = (key, entry) => withInput(key, entry, () => readInventory(key, entry))
  const select = (key, entry, model) => withInput(key, entry, () => selectOwned(key, entry, model))
  async function ensure(key, entry, model, { allowChange = false } = {}) {
    if (!model) return undefined
    const current = await inventory(key, entry)
    if (current.current === model) return current
    if (!allowChange) throw failure('model-changed-before-submit')
    return select(key, entry, model)
  }
  return { inventory, select, ensure }
}
