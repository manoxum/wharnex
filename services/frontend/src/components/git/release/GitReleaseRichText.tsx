import { useEffect, useRef } from 'react'

export function GitReleaseRichText({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const editor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (editor.current && editor.current.innerHTML !== value) editor.current.innerHTML = value
  }, [value])
  const format = (command: string) => {
    if (disabled) return
    editor.current?.focus()
    document.execCommand?.(command, false)
    onChange(editor.current?.innerHTML || '')
  }
  return <div className="git-release-editor">
    <div className="git-release-toolbar" role="toolbar" aria-label="Formatação das notas de release">
      <button type="button" disabled={disabled} onClick={() => format('bold')} aria-label="Negrito"><strong>B</strong></button>
      <button type="button" disabled={disabled} onClick={() => format('italic')} aria-label="Itálico"><em>I</em></button>
      <button type="button" disabled={disabled} onClick={() => format('insertUnorderedList')} aria-label="Lista">• Lista</button>
    </div>
    <div ref={editor} className="git-release-editable" contentEditable={!disabled} role="textbox" aria-multiline="true" aria-label="Texto manual da release" data-placeholder="Descreve as mudanças desta release…" onInput={(event) => onChange(event.currentTarget.innerHTML)} suppressContentEditableWarning/>
  </div>
}
