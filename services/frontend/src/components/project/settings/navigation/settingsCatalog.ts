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
export function settingsFooterHint(section: SettingsSection) {
  if (section === 'remote-storage') return 'A configuração de storage é global e aplica-se a todos os projetos após reiniciar.'
  if (section === 'data') return 'Os ficheiros dos projetos reais não são removidos pelas operações desta secção.'
  if (section === 'workspace') return 'O workspace padrão é local a este dispositivo e orienta os seletores da página inicial.'
  if (section === 'limits') return 'Os limites são globais e passam a valer na preparação do próximo request bundle.'
  if (section === 'appearance') return 'Preferências visuais ficam apenas neste dispositivo. As alterações são guardadas automaticamente.'
  if (section === 'composer') return 'Preferências do composer ficam apenas neste dispositivo.'
  if (section === 'language') return 'Idioma é global; traduções Markdown são temporárias e nunca reescrevem o ficheiro original.'
  return 'Snapshot final = lista exata enviada ao ChatGPT/Planner.'
}
