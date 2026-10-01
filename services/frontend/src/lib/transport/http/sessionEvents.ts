import { openLiveEventStream, type LiveEventStream } from './liveEventStream'

type Subscriber = LiveEventStream & { closed: boolean }
type Connection = { source: LiveEventStream; subscribers: Set<Subscriber> }
const connections = new Map<string, Connection>()

// One session stream feeds the workspace and every mounted feature. A Git
// drawer must not create a second socket just to observe the same session.
export function openSessionEvents(url: string): LiveEventStream {
  let connection = connections.get(url)
  if (!connection) {
    const source = openLiveEventStream(url)
    connection = { source, subscribers: new Set() }
    connections.set(url, connection)
    const current = connection
    source.onmessage = (event) => {
      for (const subscriber of current.subscribers) subscriber.onmessage?.(event)
    }
    source.onerror = () => {
      for (const subscriber of current.subscribers) subscriber.onerror?.()
    }
    source.onopen = () => {
      for (const subscriber of current.subscribers) subscriber.onopen?.()
    }
  }
  const current = connection
  const subscriber: Subscriber = {
    onmessage: null, onerror: null, onopen: null, closed: false,
    close() {
      if (subscriber.closed) return
      subscriber.closed = true
      current.subscribers.delete(subscriber)
      if (current.subscribers.size === 0) {
        current.source.close()
        if (connections.get(url) === current) connections.delete(url)
      }
    },
  }
  current.subscribers.add(subscriber)
  return subscriber
}
