import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark']) {
  test(`preserves original terminal, conversation and linked-project chrome in ${theme}`, async ({ page }) => {
    await page.route('**/ui-testing*', (route) => route.fulfill({ json: { tests: [], guides: [], environments: [], runs: [], design_tasks: [], config: {}, manuals: [] } }))
    await page.route('**/automation-holds*', (route) => route.fulfill({ json: { holds: [] } }))
    await page.goto('/e2e/tabs/fixture.html')
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme
      document.documentElement.dataset.uiAccent = 'orange'
      document.documentElement.style.setProperty('--ui-font-scale', '1.3')
    }, theme)
    const terminal = page.getByRole('tablist', { name: 'Instâncias do terminal' })
    await expect(terminal).toHaveAttribute('data-density', 'full')
    expect((await terminal.boundingBox())?.height).toBe(34)
    const terminalTab = terminal.getByRole('tab', { selected: true })
    const terminalStyle = await terminalTab.evaluate((tab) => ({
      font: parseFloat(getComputedStyle(tab).fontSize), width: tab.parentElement!.getBoundingClientRect().width,
      shadow: getComputedStyle(tab.parentElement!).boxShadow,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim(),
    }))
    expect(terminalStyle.font).toBeCloseTo(10.2 * 1.3, 2)
    expect(terminalStyle.width).toBeLessThan(138)
    expect(terminalStyle.shadow).toContain('0px -2px')
    await expect(terminalTab.locator('[data-tab-icon] svg')).toHaveCount(0)
    await expect(terminalTab.locator('[data-tab-label]')).toBeVisible()
    await expect(terminalTab.locator('[data-tab-badge]')).toHaveCount(0)
    await page.evaluate(() => { document.documentElement.dataset.density = 'compact' })
    expect(await terminalTab.evaluate((tab) => tab.parentElement!.getBoundingClientRect().height)).toBe(24)
    expect(await terminalTab.evaluate((tab) => parseFloat(getComputedStyle(tab.parentElement!).minWidth))).toBe(0)
    await page.evaluate(() => { delete document.documentElement.dataset.density })

    const conversations = page.getByRole('tablist', { name: 'Conversas abertas' })
    const conversation = conversations.getByRole('tab', { name: 'Conversa inicial', exact: true })
    const conversationStyle = await conversation.evaluate((tab) => ({
      font: parseFloat(getComputedStyle(tab).fontSize), weight: getComputedStyle(tab).fontWeight,
      height: tab.parentElement!.getBoundingClientRect().height, shadow: getComputedStyle(tab.parentElement!).boxShadow,
    }))
    expect(conversationStyle.font).toBeCloseTo(9 * 1.3, 2)
    expect(conversationStyle.weight).toBe('700')
    expect(conversationStyle.height).toBe(39)
    const conversationWidth = await conversation.evaluate((tab) => tab.parentElement!.getBoundingClientRect().width)
    expect(conversationWidth).toBeLessThan(160)
    expect(await conversations.getByRole('tab', { name: /Conversa seguinte/ }).evaluate((tab) => tab.parentElement!.getBoundingClientRect().width)).toBe(207)
    expect(conversationStyle.shadow).toContain('0px -2px')
    await expect(conversation.locator('svg')).toHaveCount(0)
    await expect(conversation.locator('[data-tab-badge]')).toHaveCount(0)
    await expect(conversation.locator('[data-tab-label] + [data-tab-icon] .linked')).toBeVisible()
    await page.locator('#conversation-owner').evaluate((owner) => { owner.style.width = '160px' })
    await expect(conversations).toHaveAttribute('data-density', 'full')
    await expect(conversation.locator('[data-tab-label]')).toBeVisible()
    expect(await conversations.evaluate((strip) => strip.scrollWidth > strip.clientWidth)).toBe(true)
    await conversation.focus(); await page.keyboard.press('ArrowRight')
    await expect(conversations.getByRole('tab', { name: /Conversa seguinte/ })).toHaveAttribute('aria-selected', 'true')

    const projects = page.getByRole('tablist', { name: 'Projetos vinculados' })
    const project = projects.getByRole('tab', { name: 'alpha', exact: true })
    const projectStyle = await project.evaluate((tab) => ({
      height: tab.getBoundingClientRect().height, radius: getComputedStyle(tab).borderRadius,
      underline: getComputedStyle(tab, '::after').width,
      unbind: getComputedStyle(tab.parentElement!.querySelector('button:last-child')!).position,
    }))
    expect(projectStyle).toEqual({ height: 30, radius: '7px', underline: '18px', unbind: 'absolute' })
    const projectWidth = await project.evaluate((tab) => tab.parentElement!.getBoundingClientRect().width)
    expect(projectWidth).toBeLessThan(160)
    const longProject = projects.getByRole('tab', { name: 'project-with-a-very-long-title', exact: true })
    const fullTitle = await longProject.locator('[data-tab-label]').evaluate((label) => ({
      width: label.clientWidth, textWidth: label.scrollWidth, overflow: getComputedStyle(label).textOverflow,
    }))
    expect(fullTitle.width).toBe(fullTitle.textWidth)
    expect(fullTitle.overflow).toBe('clip')
    expect(await longProject.evaluate((tab) => tab.parentElement!.getBoundingClientRect().width)).toBeGreaterThan(projectWidth)
    await expect(project.locator('[data-project-mark]')).toBeVisible()
    expect(await project.evaluate((tab) => getComputedStyle(tab).animationName)).toBe('wharnex-project-composer-pulse')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await project.evaluate((tab) => getComputedStyle(tab).animationName)).toBe('none')
    expect(await project.evaluate((tab) => getComputedStyle(tab).outlineWidth)).toBe('2px')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(projects).toHaveAttribute('data-density', 'full')
    await project.focus(); await page.keyboard.press('ArrowRight')
    await expect(projects.getByRole('tab', { name: 'beta', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(projects.getByRole('button', { name: 'Desvincular beta desta janela' })).toBeVisible()
    await page.locator('#projects-owner').evaluate((owner) => { owner.style.width = '160px' })
    await expect(projects).toHaveAttribute('data-density', 'full')
    expect(await projects.evaluate((strip) => strip.scrollWidth > strip.clientWidth)).toBe(true)
    expect(await longProject.locator('[data-tab-label]').evaluate((label) => label.clientWidth)).toBe(fullTitle.width)
  })
}
