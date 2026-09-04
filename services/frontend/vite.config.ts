/// <reference types="vitest/config" />
import { cpSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const monacoRuntime = resolve(import.meta.dirname, 'node_modules/monaco-editor/min/vs')

function copyMonacoRuntime(): Plugin {
  let outputDirectory = ''
  return {
    name: 'wharness-monaco-runtime',
    configResolved(config) {
      outputDirectory = config.build.outDir
    },
    closeBundle() {
      cpSync(monacoRuntime, resolve(outputDirectory, 'monaco/vs'), { recursive: true })
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), ...(command === 'build' ? [copyMonacoRuntime()] : [])],
  define: {
    __MONACO_BASE_URL__: JSON.stringify(command === 'serve' ? `/@fs${monacoRuntime}` : '/monaco/vs'),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
}))
