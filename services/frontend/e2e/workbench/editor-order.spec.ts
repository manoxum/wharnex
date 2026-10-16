import { expect, test } from '@playwright/test'

test('document order supports keyboard and drag and survives a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/workbench/fixture.html')
  await expect(page.getByRole('tab', { name: 'app.ts', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Abrir README.md', exact: true }).click()
  const tabs = page.getByRole('tablist', { name: 'Ficheiros abertos', exact: true }).getByRole('tab')
  await expect(tabs).toHaveCount(2)
  await page.getByRole('tab', { name: 'README.md', exact: true }).press('Alt+Shift+ArrowLeft')
  await expect(tabs.first()).toHaveAttribute('aria-label', 'README.md')
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
  await page.reload()
  await expect(tabs.first()).toHaveAttribute('aria-label', 'README.md')
  await page.getByRole('tab', { name: 'app.ts', exact: true }).dragTo(page.getByRole('tab', { name: 'README.md', exact: true }))
  await expect(tabs.first()).toHaveAttribute('aria-label', 'app.ts')
  await expect(tabs).toHaveCount(2)
})
