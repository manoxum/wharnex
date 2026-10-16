// Named resource exceptions share semantics and keyboard behavior with standard tabs.
export type TabAppearance = 'workbench' | 'terminal' | 'conversation' | 'project' | 'document'

const workbenchChrome = `
  rounded-none border-0 shadow-none font-semibold! min-h-[39px] gap-1.5 px-2.5
  text-sm! text-whx-faint hover:bg-whx-hover hover:text-whx-soft focus-visible:outline-[var(--theme-tab-active)]!
  aria-selected:text-whx-text after:absolute after:inset-x-[7px] after:bottom-0 after:h-0.5 after:rounded-t
  after:bg-transparent aria-selected:after:bg-[var(--theme-tab-active)]
`

export const tabButtonAppearance: Record<TabAppearance, string> = {
  terminal: `
    rounded-none border-0 shadow-none h-full min-h-0 min-w-0 flex-1 justify-start gap-[7px] font-semibold! py-0
    pl-[10px] pr-[7px] text-[length:calc(10.2px*var(--ui-font-scale))]! text-inherit
    focus-visible:outline-[var(--theme-accent)]!
  `,
  conversation: `
    rounded-none border-0 shadow-none h-[27px] min-h-0 min-w-0 max-w-[182px] gap-[7px] py-0 pl-[9px] pr-[7px]
    text-[length:calc(9px*var(--ui-font-scale))]! font-normal! text-whx-faint hover:text-whx-text
    aria-selected:text-whx-text aria-selected:font-bold! focus-visible:outline-[var(--theme-accent)]!
    [.agent-chat-switcher_&]:h-full
  `,
  project: `
    h-[30px] shrink-0 items-center gap-1.5 overflow-visible cursor-pointer border border-solid border-transparent rounded-[7px]
    transition-[border-color,box-shadow,background,color] duration-160 ease-[ease]
    py-0 pl-2 pr-[30px] text-[length:calc(9px*var(--ui-font-scale))]! font-[650]! text-[#677061] hover:bg-[#e9ece4]
    hover:text-[#31382d] focus-visible:outline-[var(--theme-accent)]! [[data-theme=dark]_&]:text-whx-faint
    [[data-theme=dark]_&]:hover:bg-whx-hover [[data-theme=dark]_&]:hover:text-whx-text
    aria-selected:border-[color-mix(in_srgb,hsl(var(--project-hue)_70%_48%)_24%,var(--theme-border))]
    aria-selected:bg-[color-mix(in_srgb,hsl(var(--project-hue)_74%_50%)_5%,var(--theme-surface))]
    aria-selected:text-whx-text
    aria-selected:shadow-[0_1px_3px_color-mix(in_srgb,var(--theme-shadow)_32%,transparent)]
    [[data-theme=dark]_&]:aria-selected:border-[hsl(var(--project-hue)_70%_58%_/_0.24)]
    [[data-theme=dark]_&]:aria-selected:bg-[color-mix(in_srgb,#2f2f2f_96%,hsl(var(--project-hue)_64%_46%))]
    [[data-theme=dark]_&]:aria-selected:text-[#f2f2f2]
    [[data-theme=dark]_&]:aria-selected:shadow-[0_1px_3px_rgba(0,0,0,.24)] after:absolute after:left-1/2
    after:bottom-[-1px] after:h-0.5 after:w-[18px] after:-translate-x-1/2 after:rounded-full after:bg-transparent
    aria-selected:after:bg-[hsl(var(--project-hue)_78%_50%)]
  `,
  document: `
    rounded-none border-0 shadow-none h-full min-h-0 min-w-0 flex-1 justify-start gap-1.5
    py-0 pl-2.5 pr-0 text-[length:calc(11px*var(--ui-font-scale))]! font-medium! text-inherit
    focus-visible:outline-[var(--theme-accent)]!
  `,
  workbench: `${workbenchChrome} shrink-0 grow justify-center`,
}
