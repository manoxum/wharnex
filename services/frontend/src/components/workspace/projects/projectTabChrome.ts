export const projectMarkChrome = `
  inline-grid size-5 shrink-0 place-items-center rounded-[5px] border border-solid
  border-[color-mix(in_srgb,hsl(var(--project-hue)_62%_48%)_16%,var(--theme-border))]
  bg-[color-mix(in_srgb,hsl(var(--project-hue)_70%_50%)_7%,var(--theme-muted))]
  text-[hsl(var(--project-hue)_62%_42%)]
  group-aria-selected/tab:border-[hsl(var(--project-hue)_72%_48%_/_0.28)]
  group-aria-selected/tab:bg-[hsl(var(--project-hue)_82%_52%_/_0.09)]
  group-aria-selected/tab:text-[hsl(var(--project-hue)_72%_40%)]
  [[data-theme=dark]_&]:border-[hsl(var(--project-hue)_68%_58%_/_0.24)]
  [[data-theme=dark]_&]:bg-[color-mix(in_srgb,#2f2f2f_90%,hsl(var(--project-hue)_66%_52%))]
  [[data-theme=dark]_&]:text-[hsl(var(--project-hue)_68%_72%)]
`
export const projectTypingChrome = `
  animate-[wharnex-project-composer-pulse_.9s_ease-in-out_infinite] motion-reduce:animate-none
  motion-reduce:border-[hsl(var(--project-hue)_78%_52%_/_0.72)]
  motion-reduce:shadow-[0_1px_3px_color-mix(in_srgb,var(--theme-shadow)_32%,transparent),0_0_0_3px_hsl(var(--project-hue)_78%_52%_/_0.14)]
  motion-reduce:outline-2 motion-reduce:outline-[hsl(var(--project-hue)_78%_52%_/_0.58)]
  motion-reduce:outline-offset-2
`
