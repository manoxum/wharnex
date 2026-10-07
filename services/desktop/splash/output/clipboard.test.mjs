import test from 'node:test'
import assert from 'node:assert/strict'
import { copySplashOutput } from './clipboard.mjs'

test('copies the current redacted output as plain text with timestamps', () => {
  let copied = ''
  const clipboard = { writeText(text) { copied = text } }
  assert.equal(copySplashOutput(clipboard, [
    { at: '2026-10-06T12:05:30Z', stream: 'stdout', text: 'Compiling frontend' },
    { at: '2026-10-06T12:05:31Z', stream: 'stderr', text: 'TOKEN=[REDACTED]' },
  ]), true)
  assert.equal(copied, '[12:05:30] Compiling frontend\n[12:05:31] TOKEN=[REDACTED]')
})

test('empty output and clipboard errors fail without interrupting startup', () => {
  assert.equal(copySplashOutput({ writeText() { assert.fail('empty output should not change the clipboard') } }, []), false)
  assert.equal(copySplashOutput({ writeText() { throw new Error('Clipboard unavailable') } }, [{ text: 'Progress' }]), false)
})
