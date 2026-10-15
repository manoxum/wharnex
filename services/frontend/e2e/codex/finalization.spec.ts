import { expect, test } from '@playwright/test'

for (const theme of ['dark', 'light']) {
  test(`native final diff, commit and version survive rendering at narrow width in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 850 })
    await page.goto('/e2e/codex/fixture.html?native=1&finalization=1')
    await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
    await expect(page.getByText('Resultado nativo · Git e versão')).toBeVisible()
    await expect(page.getByText('Execução nativa · commit abc123 · versão v1.2.3.5')).toBeVisible()
    const result = page.locator('section').filter({ has: page.getByText('Resultado nativo · Git e versão') }).last()
    await result.locator('summary').filter({ hasText: 'src/retry.ts' }).click()
    await expect(result.getByText(/\+after/)).toBeVisible()
    await expect(page.getByText('Alterações aplicadas', { exact: true })).toHaveCount(0)
    expect(await page.locator('#codex-owner').evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(false)
    await page.screenshot({ path: `/tmp/wharnex-native-finalization-${theme}.png` })
  })
}
