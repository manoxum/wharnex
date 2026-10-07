// Conversation titles keep their original chrome; shared primitives own navigation.
export const chatGroupChrome = `
  group/conversation relative inline-flex max-w-[210px] h-[31px] min-h-[31px] shrink-0 items-center
  overflow-hidden border-0 rounded-none bg-transparent shadow-none
  hover:bg-[color-mix(in_srgb,var(--theme-hover)_64%,transparent)]
  data-[selected=true]:bg-[color-mix(in_srgb,var(--theme-accent-soft)_48%,var(--theme-surface))]
  data-[selected=true]:shadow-[inset_0_-2px_var(--theme-accent),inset_0_0_0_1px_color-mix(in_srgb,var(--theme-accent)_22%,var(--theme-border))]
  [[data-theme=dark]_&]:hover:bg-whx-hover
  [[data-theme=dark]_&]:data-[selected=true]:bg-[color-mix(in_srgb,var(--theme-accent-soft)_62%,var(--theme-elevated))]
  [[data-theme=dark]_&]:data-[selected=true]:shadow-[inset_0_-2px_var(--theme-accent),inset_0_0_0_1px_color-mix(in_srgb,var(--theme-accent)_30%,var(--theme-border)),0_1px_4px_rgba(0,0,0,.24)]
  [.agent-chat-switcher_&]:h-full [.agent-chat-switcher_&]:min-h-full
  [&[draggable=true]_[role=tab]]:cursor-grab
`
export const chatActionChrome = `
  inline-grid h-[27px] w-[25px] shrink-0 place-items-center border-0 border-l border-solid border-transparent
  bg-transparent px-1.5 py-px text-[#959a90] opacity-0 transition-[opacity,color,background] duration-120
  group-hover/conversation:opacity-100 group-data-[selected=true]/conversation:opacity-100
  focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--theme-accent)]
  focus-visible:outline-offset-[-2px] disabled:cursor-default disabled:opacity-45
  [[data-theme=dark]_&]:text-[#a0a0a0] [.agent-chat-switcher_&]:h-full
`
