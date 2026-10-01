const ELECTRON_REMOTE_ERROR = /^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/i

export function errorMessage(error: unknown, fallback = 'Erro inesperado') {
  let message = ''
  if (error instanceof Error) message = error.message
  else if (typeof error === 'string') message = error
  else if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') message = error.message
  message = message.trim().replace(ELECTRON_REMOTE_ERROR, '').trim()
  return message || fallback
}
