import type { HarnessEvent } from '../../../../types/agent/task-queue'

const eventText = new WeakMap<HarnessEvent, string>()

export function eventSearchText(event: HarnessEvent) {
  const cached = eventText.get(event)
  if (cached !== undefined) return cached
  const text = JSON.stringify(event.data)
  eventText.set(event, text)
  return text
}
