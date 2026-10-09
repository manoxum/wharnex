import type { TabAppearance } from './tabAppearance'

export const tabBarAppearance: Record<TabAppearance, string> = {
  workbench: 'min-h-10 gap-0.5 border-0 border-b border-solid border-whx-border bg-whx-surface px-1.5',
  terminal: 'h-[34px] min-h-[34px] gap-0 border-0 bg-transparent p-0',
  conversation: 'min-h-0 gap-px border-0 border-b border-solid border-whx-border bg-whx-surface px-1 [.agent-chat-switcher_&]:h-full [.agent-chat-switcher_&]:self-stretch [.agent-chat-switcher_&]:border-b-0',
  project: 'h-full min-h-0 max-w-[min(42vw,560px)] flex-[0_1_auto] shrink! items-center gap-1 border-0 bg-transparent p-0 empty:flex-[0_0_0]',
  document: 'h-full min-h-0 gap-0 border-0 bg-transparent p-0',
}
