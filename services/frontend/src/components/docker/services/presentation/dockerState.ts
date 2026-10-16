import type { DockerContainer } from '../../../../types'

export function dockerCondition(container: DockerContainer) { return (container.condition || container.state || 'stopped').toLowerCase() }
export function dockerContainerRunning(container: DockerContainer) { return ['running', 'restarting'].includes(dockerCondition(container)) }
export function dockerStateTone(state: string) {
  const value = (state || '').toLowerCase()
  if (value === 'running') return 'running'
  if (value === 'error' || value === 'dead') return 'error'
  if (value === 'restarting' || value === 'paused') return 'warning'
  return 'stopped'
}
export function dockerConditionLabel(state: string) {
  const value = (state || '').toLowerCase()
  if (value === 'running') return 'A correr'
  if (value === 'error' || value === 'dead') return 'Erro'
  if (value === 'restarting') return 'A reiniciar'
  if (value === 'paused') return 'Pausado'
  if (value === 'created') return 'Criado'
  return 'Parado'
}
