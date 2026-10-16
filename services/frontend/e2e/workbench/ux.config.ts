import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5179', headless: true, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } },
  webServer: { cwd: resolve(import.meta.dirname, '../..'), command: 'npx vite build --config e2e/workbench/vite.config.ts && npx vite preview --config e2e/workbench/vite.config.ts --host 127.0.0.1 --port 5179', url: 'http://127.0.0.1:5179/e2e/workbench/fixture.html', reuseExistingServer: false },
})
