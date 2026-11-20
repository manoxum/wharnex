import { fireEvent, render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { LocaleRoot } from './LocaleRoot'
import { useTranslation } from './useTranslation'
import { interfaceLocale, readLocalePreference, resolveLocale, setLocalePreference } from './locale'
import { translate, formatMessage } from './translation'
it('resolves operating system locales, regions and unsupported languages', () => {
  expect(resolveLocale('system', ['pt-AO'])).toBe('pt')
  expect(resolveLocale('system', ['en-GB'])).toBe('en')
  expect(resolveLocale('system', ['fr_CA'])).toBe('fr')
  expect(resolveLocale('system', ['de-DE', 'en'])).toBe('en')
  expect(resolveLocale('system', [])).toBe('en')
  expect(resolveLocale('en', ['pt-PT'])).toBe('en')
})
it('starts in English unless the user has explicitly selected a language preference', () => {
  localStorage.removeItem('wharnex.interface-language.v1')
  expect(readLocalePreference()).toBe('en')
  expect(interfaceLocale()).toBe('en')
  expect(translate('Fora da árvore', 'en')).toBe('Outside the tree')
})
it('persists manual choice, follows system changes and updates the document', () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['pt-PT'])
  setLocalePreference('en')
  expect(interfaceLocale()).toBe('en')
  expect(document.documentElement.lang).toBe('en')
  expect(localStorage.getItem('wharnex.interface-language.v1')).toBe('en')
  setLocalePreference('system')
  expect(interfaceLocale()).toBe('pt')
  expect(document.documentElement.lang).toBe('pt-PT')
  vi.restoreAllMocks()
})
it('updates labels and cross-window settings without remounting live state', () => {
  function Example() { const [count, setCount] = useState(0); const t = useTranslation(); return <button onClick={() => setCount(count + 1)}>{t('Guardar')} {count}</button> }
  render(<LocaleRoot>{() => <Example/>}</LocaleRoot>)
  fireEvent.click(screen.getByRole('button', { name: 'Guardar 0' }))
  act(() => setLocalePreference('en'))
  expect(screen.getByRole('button', { name: 'Save 1' })).toBeTruthy()
  act(() => { localStorage.setItem('wharnex.interface-language.v1', 'pt'); window.dispatchEvent(new StorageEvent('storage', { key: 'wharnex.interface-language.v1' })) })
  expect(screen.getByRole('button', { name: 'Guardar 1' })).toBeTruthy()
})
it('never interprets arbitrary user content as translation input', () => {
  expect(translate('src/Guardar.tsx', 'en')).toBe('src/Guardar.tsx')
  expect(translate('Guardar', 'en')).toBe('Save')
  expect(translate('Guardar', 'pt')).toBe('Guardar')
})

it('formats authored messages without translating or recursively interpreting variables', () => {
  expect(formatMessage('Ações de {path}', { path: 'Guardar/{count}.tsx' }, 'en')).toBe('Actions for Guardar/{count}.tsx')
  expect(formatMessage('{toString}', {}, 'en')).toBe('{toString}')
})
