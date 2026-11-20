export function formatDuration(value: number) { return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s` }
