import { expect, test } from '@playwright/test'

test('typing in the owned project frame starts and refreshes the project pulse', async ({ page }) => {
  await page.route((url) => url.searchParams.get('embedded') === '1', (route) => route.fulfill({
    contentType: 'text/html', body: `<textarea aria-label="Composer"></textarea><script>
      const projectPath = new URLSearchParams(location.search).get('project');
      parent.postMessage({type:'wharness:project-ready',projectPath},location.origin);
      document.querySelector('textarea').oninput = () => parent.postMessage({type:'wharness:composer-typing',projectPath},location.origin);
    </script>`,
  }))
  await page.goto('/e2e/tabs/typing.html')
  const project = page.getByRole('tab', { name: 'alpha', exact: true })
  await expect(project).toBeVisible()
  const animation = () => project.evaluate((tab) => getComputedStyle(tab).animationName)
  expect(await animation()).toBe('none')
  const composer = page.frameLocator('iframe').getByRole('textbox', { name: 'Composer' })
  await composer.fill('Inspecionar projeto')
  await expect.poll(animation).toBe('wharnex-project-composer-pulse')
  const pulse = await project.evaluate((tab) => {
    const animation = tab.getAnimations().find((item) => item instanceof CSSAnimation)!
    animation.pause(); animation.currentTime = 450
    return { shadow: getComputedStyle(tab).boxShadow, duration: getComputedStyle(tab).animationDuration }
  })
  expect(pulse.duration).toBe('0.9s')
  expect(pulse.shadow).toContain('0px 0px 0px 4px')
  await composer.fill('Inspecionar projeto e ficheiros')
  await expect.poll(animation).toBe('wharnex-project-composer-pulse')
  await expect.poll(animation, { timeout: 5000 }).toBe('none')
})
