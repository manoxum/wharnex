import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
})
for (const theme of ['light', 'dark']) {
  test(`${theme}: wide workbench retains files, commands and keyboard focus`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/e2e/workbench/fixture.html?theme=${theme}`)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.getByRole('button', { name: 'Novo ficheiro', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: /app.ts/ })).toBeVisible()
    await page.getByRole('button', { name: 'Pesquisar e executar comandos' }).click()
    await page.getByRole('combobox', { name: 'Pesquisar comandos' }).fill('tarefas do projeto')
    await page.getByRole('combobox', { name: 'Pesquisar comandos' }).press('Enter')
    await expect(page.getByRole('heading', { name: 'Tarefas do projeto', exact: true })).toBeVisible()
    await expect(page.getByText('Nenhuma tarefa em curso.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Opções do painel Tarefas do projeto' }).click()
    await expect(page.getByRole('button', { name: 'Aumentar texto do painel Tarefas do projeto' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Opções do painel Tarefas do projeto' })).toBeFocused()
    await page.screenshot({ path: `test-results/workbench-${theme}-wide.png` })
  })

  test(`${theme}: settings adapt to a narrow window at 125% scale`, async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 800 })
    await page.goto(`/e2e/workbench/fixture.html?theme=${theme}&scale=1.25`)
    await page.getByRole('button', { name: 'Configuração do projeto', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Configurações', exact: true })
    await expect(settings).toBeVisible()
    const categories = page.getByRole('combobox', { name: 'Categoria das configurações' })
    await expect(categories).toBeVisible()
    await categories.selectOption('composer')
    await expect(page.getByRole('spinbutton', { name: 'Tamanho mínimo para transformar paste em anexo' })).toBeVisible()
    await categories.selectOption('appearance')
    const bounds = await settings.boundingBox()
    expect(bounds!.width).toBeLessThanOrEqual(720)
    expect(await settings.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `test-results/workbench-${theme}-settings-narrow.png` })
  })
}

test('composer reveals advanced capabilities and preserves its draft between workspaces', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/e2e/workbench/fixture.html')
  await page.getByRole('button', { name: 'Agent', exact: true }).click()
  const configuration = page.getByRole('group', { name: 'Configuração da conversa' })
  for (const control of [
    page.getByRole('switch', { name: 'Engine Codex' }),
    page.getByRole('combobox', { name: 'Modalidade de contexto' }),
    page.getByRole('combobox', { name: 'Esforço de raciocínio' }),
    page.getByRole('button', { name: 'Modelo do ChatGPT' }),
  ]) {
    await expect(control).toBeVisible()
    expect(await control.evaluate((element) => (element.closest('label') || element).getBoundingClientRect().height)).toBeGreaterThanOrEqual(31)
  }
  await expect(configuration).toBeVisible()
  const editor = page.locator('.ql-editor[contenteditable=true]')
  await editor.fill('Rever a função greet e explicar o resultado.')
  await page.getByRole('button', { name: 'Contexto e ferramentas' }).click()
  await expect(page.getByRole('button', { name: 'Contexto ZIP', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Contexto e ferramentas' }).getByRole('button', { name: 'Conhecimento do projeto', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Execução e transporte' }).click()
  await expect(page.getByRole('combobox', { name: 'Nível de esforço' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Editor', exact: true }).click()
  await page.getByRole('button', { name: 'Agent', exact: true }).click()
  await expect(editor).toHaveText('Rever a função greet e explicar o resultado.')
  await page.screenshot({ path: 'test-results/workbench-composer.png' })
})

test('narrow panels preserve the editor and concentration preserves the saved working layout', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 })
  await page.goto('/e2e/workbench/fixture.html')
  await page.getByRole('button', { name: 'Recolher painel sobreposto' }).click({ position: { x: 580, y: 100 } })
  await expect(page.getByRole('button', { name: 'Novo ficheiro', exact: true })).toBeHidden()
  await expect(page.getByRole('tab', { name: /app.ts/ })).toBeVisible()
  await page.getByRole('button', { name: 'Alternar painel esquerdo' }).click()
  await expect(page.getByRole('button', { name: 'Novo ficheiro', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Organizar espaço de trabalho' }).click()
  await page.getByRole('button', { name: 'Modo de concentração', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Novo ficheiro', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Recolher painel sobreposto' })).toBeHidden()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('whx.workbench.layout.v1:/workspace/atlas')!).left.open)).toBe(true)
  await page.getByRole('button', { name: 'Sair da concentração', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Novo ficheiro', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(600)
})

test('Git review keeps exact confirmation and real per-file comparisons', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e/workbench/fixture.html?surface=diff')
  await expect(page.getByRole('tablist', { name: 'Repositórios revistos' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fechar revisão', exact: true })).toBeVisible()
  await expect(page.getByLabel('Confirmação recebida')).toHaveText('Por confirmar')
  const search = page.getByRole('textbox', { name: 'Filtrar ficheiros alterados' })
  await search.fill('README')
  await page.getByRole('button', { name: 'README.md', exact: true }).click()
  await expect(page.getByRole('button', { name: 'README.md', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Comparação de README.md')).toBeVisible()
  await page.getByRole('button', { name: 'Inline', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Inline', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.line-insert').first()).toBeVisible()
  await expect(page.getByText('1/1', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/workbench-git-review.png' })
  await page.getByRole('button', { name: 'Confirmar e continuar', exact: true }).click()
  await expect(page.getByLabel('Confirmação recebida')).toHaveText('Confirmado')
})
