import { expect, test } from '@playwright/test'

test('resource tabs use only the width needed by their content', async ({ page }) => {
  await page.route('**/ui-testing*', (route) => route.fulfill({ json: { tests: [], guides: [], environments: [], runs: [], design_tasks: [], config: {}, manuals: [] } }))
  await page.route('**/automation-holds*', (route) => route.fulfill({ json: { holds: [] } }))
  await page.goto('/e2e/tabs/fixture.html')
  const terminal = page.getByRole('tab', { name: 'Terminal 1', exact: true })
  const width = () => terminal.evaluate((tab) => tab.parentElement!.getBoundingClientRect().width)
  const natural = await width()
  expect(natural).toBeLessThan(138)
  await page.locator('#resource-owner').evaluate((owner) => { owner.style.width = '1200px' })
  expect(await width()).toBe(natural)
  await page.locator('#resource-owner').evaluate((owner) => { owner.style.width = '80px' })
  expect(await width()).toBe(natural)
  await expect(terminal.locator('[data-tab-label]')).toBeVisible()
  for (const id of ['resource-owner', 'conversation-owner', 'projects-owner']) {
    const owner = page.locator(`#${id}`)
    const widths = () => owner.locator('[data-resource-tab]').evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().width))
    const initial = await widths()
    for (const size of [1200, 80, 800]) {
      await owner.evaluate((owner, size) => { owner.style.width = `${size}px` }, size)
      expect(await widths()).toEqual(initial)
    }
  }
})
