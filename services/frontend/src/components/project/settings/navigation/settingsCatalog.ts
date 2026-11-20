import type { IconName } from '../../../presentation/chrome/Icon'
export type SettingsSection = 'appearance' | 'composer' | 'language' | 'context' | 'tunnel-provider' | 'remote-storage' | 'workspace' | 'limits' | 'data'
export const SETTINGS_SECTIONS: Array<{ id: SettingsSection; group: string; label: string; description: string; icon: IconName; project?: boolean }> = [
  { id: 'appearance', group: 'Interface', label: 'Aparência', description: 'Tema, cores e tipografia', icon: 'monitor' },
  { id: 'composer', group: 'Interface', label: 'Composer', description: 'Pastes e anexos', icon: 'edit' },
  { id: 'language', group: 'Interface', label: 'Idioma', description: 'Interface e tradução', icon: 'network' },
  { id: 'context', group: 'Projeto', label: 'Contexto', description: 'Recorte enviado à IA', icon: 'file', project: true },
  { id: 'tunnel-provider', group: 'Integrações', label: 'Tunnel Provider', description: 'Ligação ao Wharnex Remote', icon: 'network' },
  { id: 'remote-storage', group: 'Integrações', label: 'Storage remoto', description: 'Contas e limites', icon: 'database' },
  { id: 'workspace', group: 'Sistema', label: 'Workspace', description: 'Pasta padrão dos projetos', icon: 'folder' },
  { id: 'limits', group: 'Sistema', label: 'Limites', description: 'Anexos e bundles por request', icon: 'shield' },
  { id: 'data', group: 'Sistema', label: 'Dados locais', description: 'Uso, retenção e limpeza', icon: 'database' },
]
