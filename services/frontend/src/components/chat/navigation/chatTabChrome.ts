// Conversation titles keep their original chrome; shared primitives own navigation.
export const chatGroupChrome = `
  group/conversation relative inline-flex max-w-[210px] h-[34px] min-h-[34px] shrink-0 items-center
  overflow-hidden border-0 rounded-none bg-transparent shadow-none
  hover:bg-[color-mix(in_srgb,var(--theme-hover)_64%,transparent)]
  data-[selected=true]:bg-[color-mix(in_srgb,var(--theme-accent-soft)_48%,var(--theme-surface))]
  data-[selected=true]:shadow-[inset_0_-2px_var(--theme-tab-active)]
  [[data-theme=dark]_&]:hover:bg-whx-hover
  [[data-theme=dark]_&]:data-[selected=true]:bg-[color-mix(in_srgb,var(--theme-accent-soft)_62%,var(--theme-elevated))]
  [[data-theme=dark]_&]:data-[selected=true]:shadow-[inset_0_-2px_var(--theme-tab-active)]
  [.agent-chat-switcher_&]:h-full [.agent-chat-switcher_&]:min-h-full
  [&[draggable=true]_[role=tab]]:cursor-grab
`
export const chatActionChrome = `
  inline-grid h-6 w-6 shrink-0 place-items-center border-0 border-l border-solid border-transparent
  bg-transparent px-1 py-px text-whx-faint opacity-0 transition-[opacity,color,background] duration-120
  group-hover/conversation:opacity-100 group-data-[selected=true]/conversation:opacity-100
  focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--theme-accent)]
  focus-visible:outline-offset-[-2px] disabled:cursor-default disabled:opacity-45
  hover:bg-whx-hover hover:text-whx-text [[data-theme=dark]_&]:text-whx-faint [.agent-chat-switcher_&]:h-full
`
