import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark']) {
  test(`${theme}: monitor prioritizes the browser and restores contextual panels`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/e2e/workbench/fixture.html?surface=monitor&theme=${theme}`)
    await expect(page.getByRole('heading', { name: 'Instâncias dos navegadores' })).toBeVisible()
    const browser = page.getByLabel('Navegador real de Supervisor 1')
    await expect(browser).toBeVisible()
    await page.getByRole('button', { name: 'Ampliar navegador', exact: true }).click()
    expect((await browser.boundingBox())!.width).toBeGreaterThan(1200)
    await expect(page.getByRole('button', { name: 'Expandir painel de detalhes' })).toBeVisible()
    await page.getByRole('button', { name: 'Restaurar painéis', exact: true }).click()
    await expect(page.getByText('Identificadores e diagnóstico', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 600, height: 800 })
    await expect(page.getByRole('button', { name: 'Expandir painel de detalhes' })).toBeVisible()
    expect((await browser.boundingBox())!.width).toBeGreaterThan(480)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(600)
    await page.screenshot({ path: `test-results/workbench-${theme}-monitor-narrow.png` })
  })
}
test('administration retains safe data actions and readable bundle and language controls', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 800 })
  await page.goto('/e2e/workbench/fixture.html?theme=light')
  await page.getByRole('button', { name: 'Configuração do projeto', exact: true }).click()
  const categories = page.getByRole('combobox', { name: 'Categoria das configurações' })
  await categories.selectOption('limits')
  await expect(page.getByRole('spinbutton', { name: 'Tamanho máximo por bundle', exact: true })).toBeVisible()
  await categories.selectOption('language')
  await expect(page.getByRole('combobox', { name: 'Idioma da interface' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /English/ })).toBeDisabled()
  await categories.selectOption('data')
  await expect(page.getByRole('button', { name: 'Limpar tudo', exact: true })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Confirmação para limpar dados' }).fill('APAGAR WHARNEX')
  await expect(page.getByRole('button', { name: 'Limpar tudo', exact: true })).toBeEnabled()
  const settings = page.getByRole('dialog', { name: 'Configurações', exact: true })
  expect(await settings.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: 'test-results/workbench-data-settings.png' })
})

test('native select options inherit the active light and dark palette', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 720, height: 800 })
    await page.goto(`/e2e/workbench/fixture.html?theme=${theme}`)
    await page.getByRole('button', { name: 'Configuração do projeto', exact: true }).click()
    const categories = page.getByRole('combobox', { name: 'Categoria das configurações' })
    const palette = await page.locator('html').evaluate((root) => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--theme-elevated)'
      probe.style.color = 'var(--theme-text)'
      root.append(probe)
      const result = { background: getComputedStyle(probe).backgroundColor, text: getComputedStyle(probe).color }
      probe.remove()
      return result
    })
    const option = await categories.evaluate((select) => {
      const item = [...(select as HTMLSelectElement).options].find((candidate) => !candidate.selected)!
      return { background: getComputedStyle(item).backgroundColor, text: getComputedStyle(item).color }
    })
    expect(option).toEqual(palette)
  }
})

test('bottom tools retain their terminal surface across diagnostics, output and collapse', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/workbench/fixture.html')
  await page.getByRole('button', { name: 'Alternar terminal', exact: true }).click()
  const terminal = page.getByTestId('fixture-terminal')
  await expect(terminal).toBeVisible()
  await page.getByRole('button', { name: 'Problemas', exact: true }).click()
  await expect(terminal).toBeHidden()
  await expect(terminal).toHaveCount(1)
  await page.getByRole('button', { name: 'Saída de execução', exact: true }).click()
  await expect(page.getByText('Sem saída de execução', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Recolher ferramentas operacionais' }).click()
  await page.getByRole('button', { name: 'Alternar terminal', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Fechar terminal', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(terminal).toBeVisible()
  await expect(terminal).toHaveCount(1)
})
