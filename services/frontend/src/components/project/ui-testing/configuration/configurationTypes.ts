import type { UITestingDocument } from '../../../../types'
export type SaveInput = { environment_id: string; profile_id?: string; url?: string; username?: string; password?: string; notes?: string }
export type ConfigurationProps = { doc: UITestingDocument; busy: boolean; onSave: (input: SaveInput) => Promise<void>; onClearSessions?: (environmentId: string) => void }
