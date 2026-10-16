import { act } from '@testing-library/react'
import QuillDelta from 'quill-delta'
import { directivesToDelta, findComposerEditor } from '../../../../lib/chat/composer/composerRichText'

// jsdom cannot simulate real keystrokes into Quill's contenteditable, so this
// drives the composer directly through its Quill instance — the same escape
// hatch ChatPanel.test.tsx uses, reached here via findComposerEditor because
// this composer is embedded several components deep, with no ref threaded
// down to it.
export function typeInComposer(container: HTMLElement, text: string) {
  const editor = findComposerEditor(container)
  if (!editor) throw new Error('composer editor not mounted')
  act(() => { editor.setContents(new QuillDelta(directivesToDelta(text).ops) as never, 'user') })
}
