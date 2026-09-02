import type { ReactNode } from 'react'

type Name = 'send' | 'play' | 'apply' | 'copy' | 'external' | 'download' | 'shield' | 'terminal' | 'plan' | 'bridge' | 'check' | 'close' | 'file' | 'folder' | 'save' | 'arrow-left' | 'arrow-right' | 'clipboard' | 'refresh' | 'code' | 'agent' | 'chatgpt' | 'reset' | 'chevron' | 'network' | 'workspace' | 'plus'

export function Icon({ name, size = 18 }: { name: Name; size?: number }) {
  const paths: Record<Name, ReactNode> = {
    send: <path d="M3 11.5 21 3l-6.5 18-3.3-6.7L3 11.5Zm8.2 2.8L21 3" />,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    apply: <path d="M5 12.5 9.2 17 19 7" />,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    external: <><path d="M14 4h6v6"/><path d="m13 11 7-7"/><path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4"/></>,
    download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
    shield: <path d="M12 22s8-3.7 8-10V5l-8-3-8 3v7c0 6.3 8 10 8 10Z" />,
    terminal: <><path d="m4 7 4 4-4 4"/><path d="M11 16h9"/></>,
    plan: <><path d="M4 6h16M4 12h10M4 18h13"/></>,
    bridge: <><circle cx="6" cy="12" r="3"/><circle cx="18" cy="12" r="3"/><path d="M9 12h6"/></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    file: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/></>,
    folder: <path d="M3 6h7l2 2h9v11H3z"/>,
    save: <><path d="M5 3h12l3 3v15H4V3z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></>,
    'arrow-left': <><path d="m14 6-6 6 6 6"/><path d="M8 12h11"/></>,
    'arrow-right': <><path d="m10 6 6 6-6 6"/><path d="M5 12h11"/></>,
    clipboard: <><rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 5V3h6v2"/></>,
    refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 9A7 7 0 0 1 18 6l2 1M18 15a7 7 0 0 1-12 3l-2-1"/></>,
    code: <><path d="m8 9-4 3 4 3"/><path d="m16 9 4 3-4 3"/><path d="m14 5-4 14"/></>,
    agent: <><rect x="5" y="7" width="14" height="12" rx="3"/><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M9 4h6"/></>,
    chatgpt: <><circle cx="12" cy="12" r="8"/><path d="M12 6v12M6 12h12M8 8l8 8M16 8l-8 8"/></>,
    reset: <><path d="M4 4v6h6"/><path d="M5.5 16a8 8 0 1 0 1-9L4 10"/></>,
    chevron: <path d="m9 6 6 6-6 6"/>,
    network: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
    workspace: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M8 9h13"/></>,
    plus: <path d="M12 5v14M5 12h14" />,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}
