import type { EffortLevel } from '../../types'

export function effortAttemptLimit(level: EffortLevel): number | undefined {
  return ({ low: 3, medium: 8, high: 15, extra_high: 20, max: 30, ultra: 50 } as Partial<Record<EffortLevel, number>>)[level]
}
