import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark']) {
  test(`linked projects preserve main chrome and composer pulse in ${theme}`, async ({ page }) => {
    await page.route('**/ui-testing*', (route) => route.fulfill({ json: { tests: [], guides: [], environments: [], runs: [], design_tasks: [], config: {}, manuals: [] } }))
    await page.route('**/automation-holds*', (route) => route.fulfill({ json: { holds: [] } }))
    await page.goto('/e2e/tabs/fixture.html')
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
    const projects = page.getByRole('tablist', { name: 'Projetos vinculados' })
    const active = projects.getByRole('tab', { name: 'alpha', exact: true })
    expect(await active.evaluate((tab) => getComputedStyle(tab).cursor)).toBe('pointer')
    expect(await projects.getByRole('button', { name: 'Desvincular alpha desta janela' }).evaluate((button) => getComputedStyle(button).cursor)).toBe('pointer')
    const pulse = await active.evaluate((tab) => {
      const style = getComputedStyle(tab)
      const animation = tab.getAnimations().find((animation) => animation instanceof CSSAnimation && animation.animationName === 'wharnex-project-composer-pulse')!
      animation.pause()
      animation.currentTime = 0
      const restingShadow = getComputedStyle(tab).boxShadow
      animation.currentTime = 450
      return {
        duration: style.animationDuration, easing: style.animationTimingFunction, iterations: style.animationIterationCount,
        transition: style.transitionProperty, transitionDuration: style.transitionDuration,
        border: getComputedStyle(tab).borderColor, background: getComputedStyle(tab).backgroundColor,
        restingShadow, peakShadow: getComputedStyle(tab).boxShadow,
      }
    })
    expect(pulse.duration).toBe('0.9s')
    expect(pulse.easing).toBe('ease-in-out')
    expect(pulse.iterations).toBe('infinite')
    expect(pulse.transition).toBe('border-color, box-shadow, background, color')
    expect(pulse.transitionDuration).toBe('0.16s')
    expect(pulse.peakShadow).not.toBe(pulse.restingShadow)
    expect(pulse.peakShadow).toContain('0px 0px 0px 4px')
    expect(pulse.peakShadow).toContain('0px 0px 18px')
    expect(pulse.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(pulse.border).not.toBe('rgba(0, 0, 0, 0)')
    expect(await projects.getByRole('tab', { name: 'beta', exact: true }).evaluate((tab) => getComputedStyle(tab).animationName)).toBe('none')
    await projects.getByRole('tab', { name: 'beta', exact: true }).click()
    expect(await active.evaluate((tab) => getComputedStyle(tab).animationName)).toBe('none')
    await expect(projects.getByRole('tab', { name: 'beta', exact: true })).toHaveAttribute('aria-selected', 'true')
  })
}
