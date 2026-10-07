// Explicit utility precedence isolates UI Lab controls from legacy global
// button/input element defaults, while all colours and type sizes use tokens.
const button = 'inline-flex items-center justify-center gap-1.5 min-h-8 cursor-pointer rounded-md! border! border-solid! px-3! py-1.5! font-sans! text-base! leading-5! font-medium! shadow-none! transition-colors focus-visible:outline-2! focus-visible:outline-[var(--theme-tab-active)]! focus-visible:outline-offset-2! disabled:cursor-not-allowed disabled:opacity-40'
export const uiPrimaryButtonClass = `${button} border-whx-accent! bg-whx-accent-soft! text-whx-accent! hover:brightness-110`
export const uiSecondaryButtonClass = `${button} border-whx-border! bg-whx-surface! text-whx-soft! hover:bg-whx-hover! hover:text-whx-text!`
export const uiInputClass = 'box-border! h-9! min-w-0 w-full rounded-md! border! border-solid! border-whx-border! bg-whx-bg! px-3! py-2! font-sans! text-base! leading-5! text-whx-text! shadow-none! placeholder:text-whx-faint! focus-visible:outline-2! focus-visible:outline-[var(--theme-tab-active)]! focus-visible:outline-offset-1!'
