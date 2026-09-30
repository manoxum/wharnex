import assert from 'node:assert/strict'
import test from 'node:test'
import { desktopAccent, desktopIconSVG, desktopInstanceName, desktopWindowTitle } from './desktop-identity.mjs'

test('desktop identity derives a bounded instance title and a stable accent', () => {
  assert.equal(desktopInstanceName('  dev   azul  '), 'dev azul')
  assert.equal(desktopWindowTitle('/work/acme', 'dev azul'), 'Wharnex · acme · dev azul')
  assert.equal(desktopAccent('dev azul'), desktopAccent('dev azul'))
  assert.match(desktopIconSVG('dev azul'), new RegExp(desktopAccent('dev azul')))
})
