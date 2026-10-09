import { expect, test } from '@playwright/test'
import { mainDocumentChrome } from './reference/mainDocumentChrome'

for (const theme of ['light', 'dark']) {
  test(`document dimensions and palette match the main implementation in ${theme}`, async ({ page }) => {
    await page.route('**/ui-testing*', (route) => route.fulfill({ json: { tests: [], guides: [], environments: [], runs: [], design_tasks: [], config: {}, manuals: [] } }))
    await page.route('**/automation-holds*', (route) => route.fulfill({ json: { holds: [] } }))
    await page.goto('/e2e/tabs/fixture.html')
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme
      document.documentElement.style.setProperty('--ui-font-scale', '1.3')
    }, theme)
    const comparison = await page.evaluate(async ({ css, theme }) => {
      const frame = document.createElement('iframe')
      frame.style.width = '800px'
      const loaded = new Promise<void>((resolve) => { frame.onload = () => resolve() })
      const rootStyle = getComputedStyle(document.documentElement)
      const variables = Array.from(rootStyle).filter((key) => key.startsWith('--')).map((key) => `${key}:${rootStyle.getPropertyValue(key)};`).join('')
      frame.srcdoc = `<style>:root {${variables}}${css}</style><div class="editor-tabs-scroll"></div>`
      document.body.append(frame)
      await loaded
      const reference = frame.contentDocument!
      reference.documentElement.dataset.theme = theme
      const strip = reference.querySelector('.editor-tabs-scroll')!
      const pairs = Array.from(document.querySelectorAll<HTMLElement>('[aria-label="Ficheiros abertos"] [data-resource-tab]')).map((group) => {
        const tab = group.querySelector<HTMLElement>('[role=tab]')!
        const main = reference.createElement('button')
        main.className = `editor-tab ${tab.getAttribute('aria-selected') === 'true' ? 'active' : ''}`
        main.innerHTML = tab.querySelector('[data-tab-icon]')!.innerHTML
        const title = reference.createElement('span')
        title.textContent = tab.getAttribute('aria-label')
        main.append(title)
        if (tab.querySelector('.dirty-dot')) main.insertAdjacentHTML('beforeend', '<i class="dirty-dot"></i>')
        main.insertAdjacentHTML('beforeend', '<span class="editor-tab-close">×</span>')
        strip.append(main)
        return { group, tab, main }
      })
      // Both copies keep the original transitions; sample their settled appearance.
      await new Promise((resolve) => setTimeout(resolve, 250))
      const sample = (element: HTMLElement, typography: HTMLElement = element) => {
        const style = getComputedStyle(element)
        const font = getComputedStyle(typography)
        return { width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
          background: style.backgroundColor, color: style.color, fontSize: font.fontSize,
          fontFamily: font.fontFamily, fontWeight: font.fontWeight }
      }
      return pairs.map(({ group, tab, main }) => ({ current: sample(group, tab), main: sample(main) }))
    }, { css: mainDocumentChrome, theme })
    for (const pair of comparison) expect(pair.current).toEqual(pair.main)
  })
}
