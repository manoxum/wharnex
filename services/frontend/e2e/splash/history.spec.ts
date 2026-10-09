import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureStartup } from '../../../desktop/splash/output/capture.mjs'
import { createSplashOutputReader } from '../../../desktop/splash/output/index.mjs'
import { splashPage } from '../../../desktop/splash/view/index.mjs'

test('expanded splash retains the entire startup history across incremental updates', async ({ page }) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wharnex-splash-browser-history-'))
  try {
    const outputFile = path.join(directory, 'startup.output')
    const output = { write() {} }
    await captureStartup(process.execPath, ['-e', "for(let i=0;i<2500;i++) console.log('Startup step '+i+' '+'.'.repeat(500))"], { file: outputFile, stdout: output, stderr: output })
    await captureStartup(process.execPath, ['-e', "console.error('Final diagnostic')"], { file: outputFile, stdout: output, stderr: output })
    const rows = createSplashOutputReader({ outputFile, environment: {} })({ drain: true })
    expect(rows).toHaveLength(2501)
    await page.setViewportSize({ width: 700, height: 570 })
    await page.setContent(splashPage())
    const first = { status: 'A montar o teu espaço…', entries: rows.slice(0, 250), append: true, from: 0, latest: rows.at(-1), failed: false }
    await page.evaluate((state) => window.setSplashState(state), first)
    await page.evaluate((state) => window.setSplashState(state), first)
    await expect(page.locator('.line')).toHaveCount(250)
    await expect(page.locator('#latest-output .text')).toHaveText('Final diagnostic')
    for (let from = 250; from < rows.length; from += 250) {
      await page.evaluate((state) => window.setSplashState(state), { ...first, entries: rows.slice(from, from + 250), from })
    }
    await expect(page.locator('.line')).toHaveCount(2501)
    await page.getByRole('button', { name: 'Expandir registos de arranque' }).click()
    await expect(page.locator('.line').last()).toBeInViewport()
    await page.locator('#logs').evaluate((logs) => { logs.scrollTop = 0; logs.dispatchEvent(new Event('scroll')) })
    await expect(page.locator('.line').first()).toBeInViewport()
    await expect(page.locator('.line .text').first()).toHaveText(rows[0].text)
    const additional = { ...rows.at(-1), text: 'Additional diagnostic' }
    await page.evaluate((state) => window.setSplashState(state), { ...first, entries: [additional], latest: additional, from: rows.length })
    expect(await page.locator('#logs').evaluate((logs) => logs.scrollTop)).toBe(0)
    await expect(page.locator('.line')).toHaveCount(2502)
    await expect(page.locator('.line .text').first()).toHaveText(rows[0].text)
    await page.getByRole('button', { name: 'Recolher registos de arranque' }).click()
    await expect(page.locator('#latest-output .text')).toHaveText('Additional diagnostic')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
