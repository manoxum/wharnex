/// <reference types="vitest/config" />
import { cpSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
  plugins: [react(), tailwindcss(), ...(command === 'build' ? [copyMonacoRuntime()] : [])],
  define: {
    __MONACO_BASE_URL__: JSON.stringify(command === 'serve' ? `/@fs${monacoRuntime}` : '/monaco/vs'),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        // These are all React.lazy()-loaded from WorkspaceSideRail and only
        // ever rendered once their drawer is opened - most are opened rarely,
        // if at all, in a given session (Git graph, Postgres browser,
        // runtime/task inspectors, knowledge/artifact explorers). Rollup's
        // automatic dynamic-import splitting was not separating them from
        // the entry chunk on its own here, so chunk assignment is explicit.
        manualChunks(id) {
          if (id.includes('/src/components/git/review/GitDrawer')) return 'panel-git'
          if (id.includes('/src/components/database/browser/DatabaseExplorerPanel')) return 'panel-database'
          if (id.includes('/src/components/artifacts/explorer/ArtifactExplorerPanel')) return 'panel-artifacts'
          if (id.includes('/src/components/agent/runtime/AgentRuntimeDrawer')) return 'panel-runtime'
          if (id.includes('/src/components/chat/tasks/ChatAgentTasksDrawer')) return 'panel-tasks'
          if (id.includes('/src/components/project/knowledge/ProjectKnowledgeDrawer')) return 'panel-knowledge'
          if (id.includes('/src/components/project/knowledge/EvolutionEvidenceDrawer')) return 'panel-evolution'
          if (id.includes('/src/components/agent/explorer/AgentProjectExplorer')) return 'panel-explorer'
          if (id.includes('/src/components/project/tasks/ProjectActivityDrawer')) return 'panel-activity'
          if (id.includes('/src/components/project/tasks/ProjectTodoPanel')) return 'panel-todo'
        },
      },
    },
  },
  test: {
    maxWorkers: 2,
    minWorkers: 1,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
}))
