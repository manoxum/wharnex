export const testStatuses: Record<string, { label: string; tone: string }> = {
  ready: { label: 'Por executar', tone: 'text-whx-faint bg-whx-muted' },
  queued: { label: 'Na fila', tone: 'text-whx-soft bg-whx-muted' },
  waiting: { label: 'Em espera', tone: 'text-whx-warning bg-whx-warning/10' },
  running: { label: 'Em execução', tone: 'text-whx-accent bg-whx-accent-soft' },
  passed: { label: 'Aprovado', tone: 'text-whx-success bg-whx-success/10' },
  failed: { label: 'Falhou', tone: 'text-whx-danger bg-whx-danger/10' },
  blocked: { label: 'Bloqueado', tone: 'text-whx-warning bg-whx-warning/10' },
  skipped: { label: 'Ignorado', tone: 'text-whx-faint bg-whx-muted' },
}
export function testStatus(value: string) { return testStatuses[value] || { label: value, tone: 'text-whx-faint bg-whx-muted' } }
