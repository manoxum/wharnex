import { MAX_PERSISTED_TERMINAL_HISTORY } from './interactiveTerminalSupport'

export type TerminalSnapshot = { cwd: string; history: string; viewportY: number }

export function createTerminalHistory(initial: string, cwd: string, viewportY: () => number, emit: (snapshot: TerminalSnapshot) => void) {
  let history = initial.slice(-MAX_PERSISTED_TERMINAL_HISTORY)
  let timer: ReturnType<typeof setTimeout> | undefined
  const snapshot = () => {
    history = history.slice(-MAX_PERSISTED_TERMINAL_HISTORY)
    emit({ cwd, history, viewportY: viewportY() })
  }
  const schedule = () => {
    if (timer) return
    timer = setTimeout(() => { timer = undefined; snapshot() }, 1500)
  }
  return {
    initial: history,
    append(data: string) {
      history += data
      if (history.length > MAX_PERSISTED_TERMINAL_HISTORY + 64 * 1024) history = history.slice(-MAX_PERSISTED_TERMINAL_HISTORY)
      schedule()
    },
    schedule,
    flush() { if (timer) clearTimeout(timer); timer = undefined; snapshot() },
  }
}
