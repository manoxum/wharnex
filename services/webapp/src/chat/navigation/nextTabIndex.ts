export function nextTabIndex(key: string, current: number, count: number): number | undefined {
  if (count < 1 || current < 0) return undefined
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowRight') return (current + 1) % count
  if (key === 'ArrowLeft') return (current + count - 1) % count
  return undefined
}
