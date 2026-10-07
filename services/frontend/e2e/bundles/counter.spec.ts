import { expect, test } from '@playwright/test'

const quota = {
  window_hours: 3, limit: 80, sent: 135, received: 129, total: 264, warning: true,
  window_start: '2026-10-06T11:57:23Z', window_end: '2026-10-06T14:57:23Z', source: 'transport', estimated_received: 128,
  by_task_type: [
    { type: 'UI_TEST_RUN', sent: 134, received: 128, total: 262, estimated_received: 128 },
    { type: 'UI_TEST_DISCOVER', sent: 1, received: 1, total: 2, estimated_received: 0 },
  ],
}

for (const theme of ['light', 'dark']) {
  test(`lower-right bundle counter opens an accessible task breakdown in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.route('**/api/bundle-quota', (route) => route.fulfill({ json: quota }))
    await page.goto('/e2e/bundles/fixture.html')
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
    const counter = page.getByRole('button', { name: 'Bundles nas últimas 3 horas' })
    await expect(counter).toBeVisible()
    const position = await counter.boundingBox()
    expect(position!.x + position!.width).toBeGreaterThan(1260)
    expect(position!.y).toBeGreaterThan(690)
    await counter.focus()
    await page.keyboard.press('Enter')
    const popup = page.getByRole('dialog', { name: 'Bundles nas últimas 3 horas' })
    await expect(popup).toBeVisible()
    await expect(popup).toHaveAttribute('aria-modal', 'false')
    await expect(popup.getByRole('row').filter({ hasText: 'UI_TEST_RUN' })).toContainText('134')
    await expect(popup.getByRole('row').last()).toContainText('264')
    await expect(popup.getByText(/128 recebidos estimados/)).toBeVisible()
    await page.screenshot({ path: `${process.env.WHARNEX_BUNDLE_SCREENSHOT_DIR || '/tmp'}/bundle-statistics-${theme}.png` })
    await page.getByRole('button', { name: 'Ação do workspace' }).click()
    await expect(popup).toBeVisible() // Surrounding workspace remains interactive.
    await popup.getByRole('button', { name: 'Minimizar Bundles nas últimas 3 horas' }).click()
    await expect(popup).toBeHidden()
    await page.getByTitle('Restaurar Bundles nas últimas 3 horas', { exact: true }).click()
    await expect(popup).toBeVisible()
    await popup.getByRole('button', { name: 'Fechar', exact: true }).focus()
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)
    await expect(counter).toBeFocused()
    await page.setViewportSize({ width: 640, height: 600 })
    await counter.click()
    await expect(popup).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  })
}

test('an older statistics service explains missing task details and recovers after updating', async ({ page }) => {
  let updated = false
  await page.route('**/api/bundle-quota', (route) => route.fulfill({ json: updated ? quota : {
    window_hours: 3, limit: 80, sent: 1, received: 0, total: 1, warning: false,
    window_start: quota.window_start, window_end: quota.window_end,
  } }))
  await page.goto('/e2e/bundles/fixture.html')
  await page.getByRole('button', { name: 'Bundles nas últimas 3 horas' }).click()
  const popup = page.getByRole('dialog', { name: 'Bundles nas últimas 3 horas' })
  await expect(popup.getByRole('status')).toContainText('Atualize o Wharnex')
  await expect(popup.getByRole('row').last().getByRole('cell')).toHaveText(['1', '0', '1'])
  updated = true
  await popup.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await expect(popup.getByRole('row').filter({ hasText: 'UI_TEST_RUN' })).toBeVisible()
  await expect(popup.getByRole('status')).toHaveCount(0)
})
