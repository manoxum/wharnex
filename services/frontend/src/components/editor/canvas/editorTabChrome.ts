// Main-branch document chrome, kept separate from expanding panel tabs.
export const editorTabBarChrome = `
  flex h-[36px] min-w-0 flex-[0_0_36px] items-center justify-between overflow-hidden
  border-0 border-b border-solid border-whx-border bg-whx-surface p-0
  [[data-theme=light]_&]:bg-[#e6eae2] [[data-theme=dark]_&]:border-[#383838]
  [[data-theme=dark]_&]:bg-[#171717]
`

export const editorDocumentChrome = `
  group/document relative flex h-[36px] min-w-0 max-w-[230px] shrink-0 items-center gap-1.5
  border-0 border-r border-solid border-transparent rounded-none bg-transparent pr-2.5 text-whx-faint
  transition-[background-color,color,box-shadow] duration-[var(--motion-fast)]
  hover:bg-[color-mix(in_srgb,var(--theme-hover)_54%,transparent)] hover:text-whx-soft
  data-[selected=true]:text-whx-text data-[selected=true]:shadow-[inset_0_-2px_var(--theme-accent)]
  [[data-theme=light]_&]:bg-[#e9ece5] [[data-theme=light]_&]:text-[#687265]
  [[data-theme=light]_&]:hover:bg-[#f0f2ed] [[data-theme=light]_&]:hover:text-[#3f473c]
  [[data-theme=light]_&]:data-[selected=true]:bg-[color-mix(in_srgb,var(--theme-accent-soft)_58%,#f7f8f4)]
  [[data-theme=light]_&]:data-[selected=true]:text-[#242a21]
  [[data-theme=light]_&]:data-[selected=true]:shadow-[inset_0_-2px_var(--theme-accent),inset_0_0_0_1px_color-mix(in_srgb,var(--theme-accent)_24%,var(--theme-border))]
  [[data-theme=dark]_&]:bg-[#292929] [[data-theme=dark]_&]:text-[#b8b8b8]
  [[data-theme=dark]_&]:hover:bg-[#303030] [[data-theme=dark]_&]:hover:text-[#dedede]
  [[data-theme=dark]_&]:data-[selected=true]:bg-[color-mix(in_srgb,var(--theme-accent-soft)_62%,#212121)]
  [[data-theme=dark]_&]:data-[selected=true]:text-[#f2f2f2]
  [[data-ui-theme]:not([data-ui-theme=original])_&]:hover:bg-whx-hover
  [[data-ui-theme]:not([data-ui-theme=original])_&]:hover:text-whx-text
  [[data-theme=dark]_&]:data-[selected=true]:shadow-[inset_0_-2px_var(--theme-accent),inset_0_0_0_1px_color-mix(in_srgb,var(--theme-accent)_30%,#383838)]
`

export const editorCloseChrome = `
  ml-0.5 grid size-[18px] shrink-0 place-items-center rounded-[4px] border-0 bg-transparent p-0 font-sans! text-[14px]! font-normal! leading-none!
  text-[#6f776a] opacity-18 transition-[opacity,color] duration-[var(--motion-fast)]
  group-hover/document:opacity-70 group-data-[selected=true]/document:opacity-70 focus-visible:opacity-100
  hover:bg-[#373c34] hover:text-[#d6ddcf] [[data-theme=light]_&]:text-[#818a7e]
  [[data-theme=light]_&]:hover:bg-[#dce1d8] [[data-theme=light]_&]:hover:text-[#343c31]
`
