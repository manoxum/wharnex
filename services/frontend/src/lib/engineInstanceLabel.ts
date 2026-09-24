export function supervisorInstanceLabel(supervisorId?: string) {
  const match = /^supervisor-([1-9][0-9]*)$/.exec(String(supervisorId || '').trim())
  return match ? `Supervisor ${match[1]}` : 'Supervisor'
}
