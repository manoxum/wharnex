import type { DialogTone } from '../appDialog'

export function toneIcon(tone: DialogTone) {
  if (tone === 'success') return '✓'
  if (tone === 'danger') return '!'
  if (tone === 'warning') return '!'
  if (tone === 'info') return 'i'
  return '•'
}

export function toneLabel(tone: DialogTone) {
  if (tone === 'success') return 'Concluído'
  if (tone === 'danger') return 'Ação crítica'
  if (tone === 'warning') return 'Atenção'
  if (tone === 'info') return 'Informação'
  return 'Wharnex'
}

// Structural hooks remain stable for Desktop overlay detection and callers.
export function styleDialog(root: HTMLElement) {
  const classes: Record<string, string> = {
    '.app-dialog-backdrop': '[&.is-minimized]:!hidden !pointer-events-auto !fixed !inset-0 !z-[10060] !grid !place-items-center !p-4 !bg-[var(--theme-overlay)] !backdrop-blur-sm',
    '.internal-window-shell': 'w-[min(420px,calc(100vw-32px))] !max-w-[calc(100vw-32px)]',
    '.app-dialog-card': '!grid !w-full !grid-cols-[24px_minmax(0,1fr)] !gap-3 !rounded-lg !border !border-whx-border !bg-whx-surface !p-5 !pt-10 !text-whx-text !shadow-[0_16px_48px_var(--theme-shadow)]',
    '.app-dialog-icon': '!grid !size-6 !place-items-center !rounded-md !bg-whx-muted !text-whx-warning !text-whx-label',
    '.app-dialog-content': 'min-w-0',
    '.app-dialog-eyebrow': 'hidden',
    '.app-dialog-card h2': '!m-0 !text-[calc(15px*var(--ui-font-scale))] !font-semibold !leading-snug !text-whx-text',
    '.app-dialog-message': '!mb-0 !mt-2 !whitespace-pre-line !break-words !text-whx-label !leading-relaxed !text-whx-soft',
    '.app-dialog-body': 'mt-3',
    '.app-dialog-field': 'grid gap-2 text-whx-label text-whx-soft',
    '.app-dialog-field input,.app-dialog-field textarea': '!box-border !min-h-8 !w-full !rounded-md !border !border-whx-border !bg-whx-bg !px-2 !py-1.5 !text-whx-label !text-whx-text focus:!outline-2 focus:!outline-whx-accent',
    '.app-dialog-field-error': 'min-h-4 text-whx-caption text-whx-danger',
    '.app-dialog-actions': '!mt-5 !flex !flex-wrap !justify-end !gap-2',
    '.app-dialog-button': '!min-h-8 !rounded-md !border !px-3 !py-1.5 !text-whx-label !font-medium transition-colors focus-visible:!outline-2 focus-visible:!outline-whx-accent',
    '.app-dialog-button.secondary': '!border-whx-border !bg-whx-surface !text-whx-soft hover:!bg-whx-hover',
    '.app-dialog-button.primary': '!border-whx-accent !bg-whx-accent !text-[color:var(--theme-bg)] hover:!brightness-110',
    '.app-dialog-button.primary.tone-danger': '!border-whx-danger !bg-whx-danger',
    '.app-dialog-button.primary.tone-warning': '!border-whx-warning !bg-whx-warning',
  }
  for (const [selector, value] of Object.entries(classes)) {
    if (root.matches(selector)) root.classList.add(...value.split(' '))
    root.querySelectorAll(selector).forEach((element) => element.classList.add(...value.split(' ')))
  }
}
