import { act } from '@testing-library/react'
import { createRef, type RefObject } from 'react'
import QuillDelta from 'quill-delta'
import type { ChatPanelHandle } from '../ChatPanel'
import type { Session } from '../../../../types'
import { deltaToCanonicalText, directivesToDelta, textOffsetToQuillIndex } from '../../../../lib/chat/composer/composerRichText'

// jsdom cannot faithfully simulate real keystrokes into a contenteditable
// Quill instance (no real Selection/Range layout), so these tests drive the
// composer directly through the same Quill API ChatPanel's own directive
// handlers use internally (see ChatPanel.editDirective / selectDirective),
// via the escape hatch ChatPanelHandle exposes for exactly this reason.
export function panelRef() { return createRef<ChatPanelHandle>() }

export function typeInComposer(ref: RefObject<ChatPanelHandle | null>, text: string, caret: number) {
  const editor = ref.current?.getComposerEditor()
  if (!editor) throw new Error('composer editor not mounted')
  act(() => {
    editor.setContents(new QuillDelta(directivesToDelta(text).ops) as never, 'user')
    editor.setSelection(textOffsetToQuillIndex(text, caret), 0, 'user')
  })
}

export function composerText(ref: RefObject<ChatPanelHandle | null>) {
  const editor = ref.current?.getComposerEditor()
  return editor ? deltaToCanonicalText(editor.getContents() as never) : ''
}

export function readFileText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error(`Não foi possível ler ${file.name}.`))
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsText(file)
  })
}

export const session = {
  id: 'ses-test',
  project_path: '/tmp/demo',
  state: 'ready',
  execution_mode: 'protected',
  automation_mode: 'manual',
  created_at: new Date().toISOString(),
  context: {
    id: 'ctx-test',
    manifest: {
      id: 'ctx-test',
      project_root: '/tmp/demo',
      sha256: 'abcdef1234567890',
      files: [],
      excluded: [],
      text_truncated: false,
    },
  },
} satisfies Session

export const chatActions = {
  archivedChats: [],
  onNewChat: async () => undefined,
  onSelectChat: async () => undefined,
  onArchiveChat: async () => undefined,
  onRestoreChat: async () => undefined,
  onDeleteArchivedChat: async () => undefined,
}
