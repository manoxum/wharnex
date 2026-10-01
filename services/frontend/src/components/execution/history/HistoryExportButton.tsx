import type { MouseEvent } from 'react'
import { Icon } from '../../presentation/chrome/Icon'

export function HistoryExportButton({ label, onExport }: { label: string; onExport: () => void }) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    onExport()
  }
  return <button type="button" className="history-action" onClick={handleClick} title={label} aria-label={label}><Icon name="download" size={13}/></button>
}
