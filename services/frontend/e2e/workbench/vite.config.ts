import { resolve } from 'node:path'
import { defineConfig, mergeConfig } from 'vite'
import frontendConfig from '../../vite.config'

// Exercise the shipped local Monaco distribution, including its real workers.
// Output is private to the disposable browser-test container.
export default defineConfig((environment) => mergeConfig(frontendConfig(environment), {
  build: {
    outDir: '/tmp/wharnex-workbench-browser',
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, 'fixture.html') },
  },
}))
