import assert from 'node:assert/strict'
import test from 'node:test'
import { markdownTranslationFilename, todoClassificationFilename } from './filenames.mjs'

test('utility artifact names bind to the exact durable task id', () => {
  const id = `cat_${'a'.repeat(20)}`
  assert.equal(markdownTranslationFilename(id), `whx_translation_res_${id}.zip`)
  assert.equal(todoClassificationFilename(id), `whx_todo_classification_res_${id}.zip`)
  assert.throws(() => markdownTranslationFilename('cat_../other'), /invalid translation task id/)
  assert.throws(() => todoClassificationFilename('other'), /invalid TODO classification task id/)
})
