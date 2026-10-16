export const testStatuses: Record<string, { label: string; tone: string }> = {
  ready: { label: 'Por executar', tone: 'text-whx-faint' },
  queued: { label: 'Na fila', tone: 'text-whx-soft' },
  waiting: { label: 'Em espera', tone: 'text-whx-warning' },
  running: { label: 'Em execução', tone: 'text-whx-running' },
  passed: { label: 'Aprovado', tone: 'text-whx-success' },
  failed: { label: 'Falhou', tone: 'text-whx-danger' },
  blocked: { label: 'Bloqueado', tone: 'text-whx-warning' },
  skipped: { label: 'Ignorado', tone: 'text-whx-faint' },
}
export function testStatus(value: string) { return testStatuses[value] || { label: value, tone: 'text-whx-faint' } }
