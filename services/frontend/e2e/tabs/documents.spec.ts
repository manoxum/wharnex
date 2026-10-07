import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark']) {
  test(`editor documents restore main dimensions, titles and keyboard selection in ${theme}`, async ({ page }) => {
    await page.route('**/ui-testing*', (route) => route.fulfill({ json: { tests: [], guides: [], environments: [], runs: [], design_tasks: [], config: {}, manuals: [] } }))
    await page.route('**/automation-holds*', (route) => route.fulfill({ json: { holds: [] } }))
    await page.goto('/e2e/tabs/fixture.html')
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme
      document.documentElement.dataset.uiAccent = 'orange'
      document.documentElement.style.setProperty('--ui-font-scale', '1.3')
    }, theme)
    const strip = page.getByRole('tablist', { name: 'Ficheiros abertos' })
    const first = strip.getByRole('tab', { name: 'App.tsx', exact: true })
    const long = strip.getByRole('tab', { name: 'DocumentWithAVeryLongFilenameAndUnsavedChanges.tsx', exact: true })
    await expect(first).toHaveAttribute('title', 'src/App.tsx')
    await expect(first.locator('.dirty-dot')).toBeVisible()
    await expect(strip.getByRole('button', { name: 'Fechar src/App.tsx', exact: true })).toBeVisible()
    expect(await first.evaluate((tab) => tab.parentElement!.getBoundingClientRect().height)).toBe(36)
    const naturalWidths = await strip.locator('[data-resource-tab]').evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().width))
    expect(naturalWidths[0]).toBeLessThan(naturalWidths[1])
    expect(naturalWidths[1]).toBeLessThanOrEqual(230)
    for (const width of [800, 120, 600]) {
      await page.locator('#resource-owner').evaluate((owner, width) => { owner.style.width = `${width}px` }, width)
      await expect(strip).toHaveAttribute('data-density', 'full')
      expect(await strip.locator('[data-resource-tab]').evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().width))).toEqual(naturalWidths)
      for (const tab of [first, long]) {
        await expect(tab.locator('[data-tab-label]')).toBeVisible()
      }
      const truncation = await long.locator('[data-tab-label]').evaluate((label) => ({
        overflow: getComputedStyle(label).textOverflow, clipped: label.scrollWidth > label.clientWidth,
      }))
      expect(truncation).toEqual({ overflow: 'ellipsis', clipped: true })
      expect(await strip.evaluate((strip) => strip.scrollWidth > strip.clientWidth)).toBe(width === 120)
    }
    await first.focus()
    await page.keyboard.press('ArrowRight')
    await expect(long).toHaveAttribute('aria-selected', 'true')
    await expect(first).toHaveAttribute('aria-selected', 'false')
    await expect.poll(() => long.evaluate((tab) => getComputedStyle(tab.parentElement!).boxShadow)).toContain('0px -2px')
    expect(await long.evaluate((tab) => getComputedStyle(tab).fontSize)).toBe('10px')
    await page.screenshot({ path: test.info().outputPath('resource-tabs.png'), fullPage: true })
  })
}
