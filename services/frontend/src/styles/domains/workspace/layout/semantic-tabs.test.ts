import { describe, expect, it } from 'vitest'
import { css } from '../../../cascade/styleRules'

describe('canonical tab stylesheet migration', () => {
  it('removes old semantic and resource selectors so Tailwind can govern every tab', () => {
    for (const name of ['git-tabs', 'git-changes-tabs', 'project-todo-tabs', 'agent-runtime-tabs', 'database-workspace-tabs',
      'composer-attachment-tabs', 'chat-tab-group', 'editor-tab', 'terminal-tab-shell', 'project-tab-main']) {
      expect(css).not.toMatch(new RegExp(`\\.${name}(?![\\w-])`))
    }
  })
})
