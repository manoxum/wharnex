import test from 'node:test'
import assert from 'node:assert/strict'
import { spellcheckContextMenuTemplate } from './spellcheck-menu.mjs'

test('spellcheck menu applies a chosen correction and can add the word to the dictionary', () => {
  const calls = []
  const template = spellcheckContextMenuTemplate({
    isEditable: true,
    misspelledWord: 'autografo',
    dictionarySuggestions: ['ortógrafo', 'autógrafo', 'autógrafo'],
    editFlags: { canUndo: true, canCopy: true, canSelectAll: true },
  }, {
    replaceMisspelling: (suggestion) => calls.push(['replace', suggestion]),
    addToDictionary: (word) => calls.push(['dictionary', word]),
  })

  const correction = template.find((item) => item.label === 'autógrafo')
  const dictionary = template.find((item) => item.label === 'Adicionar ao dicionário')
  assert.equal(typeof correction?.click, 'function')
  assert.equal(typeof dictionary?.click, 'function')
  correction.click()
  dictionary.click()
  assert.deepEqual(calls, [['replace', 'autógrafo'], ['dictionary', 'autografo']])
  assert.equal(template.filter((item) => item.label === 'autógrafo').length, 1)
})

test('spellcheck menu keeps normal editing actions and stays inactive outside editable content', () => {
  assert.deepEqual(spellcheckContextMenuTemplate({ isEditable: false }), [])

  const template = spellcheckContextMenuTemplate({
    isEditable: true,
    dictionarySuggestions: [],
    editFlags: { canPaste: true, canSelectAll: true },
  })
  assert.equal(template.some((item) => item.label === 'Adicionar ao dicionário'), false)
  assert.equal(template.find((item) => item.role === 'paste')?.enabled, true)
  assert.equal(template.find((item) => item.role === 'selectAll')?.enabled, true)
})
