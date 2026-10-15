import { expect, test } from '@playwright/test'

test('native completion reaches the shared Desktop notification channel once', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.goto('/e2e/codex/fixture.html?native=1&notifications=1')
  const notices = page.getByLabel('Notificações de conclusão')
  await expect(notices).toHaveText('0 · A aguardar conclusão')
  await page.getByRole('button', { name: 'Pedir decisão de teste' }).click()
  await expect(notices).toHaveText('0 · A aguardar conclusão')
  await page.getByRole('radio', { name: /Corrigir agora/ }).check()
  await page.getByRole('button', { name: 'Responder ao Codex' }).click()
  await expect(notices).toHaveText('1 · Tarefa concluída')
  await expect(notices).toHaveAttribute('data-chat-id', 'chat-parser')
  await page.getByRole('button', { name: 'Atualizar Codex' }).click()
  await expect(notices).toHaveText('1 · Tarefa concluída')
})
