import { expect, test } from '@playwright/test'

test('Ctrl+Enter delivers guidance to the running Codex while plain Enter queues the next prompt', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: { items: [], files: [], artifacts: [] } }))
  await page.goto('/e2e/codex/fixture.html?native=1&incremental=1')
  await expect(page.getByRole('status').filter({ hasText: 'A trabalhar' })).toBeVisible()
  const editor = page.locator('.composer-rich-editor .ql-editor')
  await editor.fill('Inclua também um teste de regressão.')
  await editor.press('Control+Enter')
  await expect(page.getByText('Orientação recebida durante a execução.')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'A trabalhar' })).toBeVisible()
  await expect(page.getByLabel('Pedidos em fila')).toHaveText('0')
  await expect(editor).toHaveText('')
  await editor.fill('Pedido para executar depois.')
  await editor.press('Enter')
  await expect(page.getByLabel('Pedidos em fila')).toHaveText('1')
  await page.screenshot({ path: '/tmp/wharnex-codex-incremental.png' })
})
