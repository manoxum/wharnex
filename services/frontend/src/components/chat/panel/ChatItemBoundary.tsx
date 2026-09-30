import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from '../../presentation/chrome/Icon'

/**
 * Contains a render failure to the one chat item that caused it.
 *
 * Without a boundary anywhere in the tree, a single throwing item — a malformed
 * transcript entry, an unexpected shape in a change summary, markdown the
 * renderer cannot handle — unmounts the entire workspace and leaves a blank
 * window with the cause visible only in DevTools. That turns a cosmetic defect
 * in one message into total loss of the UI.
 *
 * The fallback deliberately shows the error text rather than a generic apology:
 * the person hitting it is usually the one who can report what they were doing,
 * and the message is what makes that report actionable.
 */
export class ChatItemBoundary extends Component<{ children: ReactNode; label?: string }, { error?: Error }> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the full component stack in the console for diagnosis; the visible
    // card stays short.
    console.error('[wharnex] chat item render failed', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="chat-notice notice-wharness notice-status" role="alert">
        <div className="notice-content">
          <strong><Icon name="close" size={12}/> {this.props.label || 'Este item não pôde ser apresentado'}</strong>
          <p>O resto do chat continua utilizável. Comunique esta mensagem para que a causa possa ser corrigida.</p>
          <pre className="chat-item-error">{error.message || String(error)}</pre>
        </div>
      </div>
    )
  }
}
