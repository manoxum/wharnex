import type { IconName } from '../../../presentation/chrome/Icon'

export type WorkbenchCommand = { id: string; label: string; description: string; icon: IconName; group?: string; shortcut?: string; run: () => void }
