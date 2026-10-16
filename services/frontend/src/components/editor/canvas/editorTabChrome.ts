// Open documents use the shared resource tab semantics with compact IDE chrome.
export const editorTabBarChrome = 'flex h-9 min-w-0 flex-[0_0_36px] items-center overflow-hidden border-0 border-b border-solid border-whx-border-soft bg-whx-surface p-0'

export const editorDocumentChrome = `
  group/document relative flex h-9 w-max min-w-0 max-w-[230px] shrink-0 items-center gap-0
  border-0 border-r border-solid border-whx-border-soft rounded-none bg-transparent text-whx-faint
  transition-[background-color,color,box-shadow] duration-[var(--motion-fast)] hover:bg-whx-hover hover:text-whx-text
  data-[selected=true]:bg-[color-mix(in_srgb,var(--theme-accent)_8%,var(--theme-surface))]
  data-[selected=true]:text-whx-text data-[selected=true]:shadow-[inset_0_-2px_var(--theme-accent)]
`

export const editorCloseChrome = `
  ml-0.5 grid size-6 shrink-0 place-items-center rounded-[4px] border-0 bg-transparent p-0 text-whx-faint opacity-0
  transition-[opacity,color,background-color] duration-[var(--motion-fast)] group-hover/document:opacity-100
  group-data-[selected=true]/document:opacity-100 focus-visible:opacity-100 hover:bg-whx-hover hover:text-whx-text
`
