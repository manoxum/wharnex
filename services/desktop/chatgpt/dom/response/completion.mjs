import { composerLookupSource } from '../chatgpt-composer-lookup.mjs'
import { responseTurnLookupSource } from './turns.mjs'

export function chatGPTAssistantTurnCountScript() {
  return `(() => { ${responseTurnLookupSource()} return assistantCount; })()`
}

export function chatGPTResponseCompletionScript(assistantBaseline = 0) {
  const baseline = Math.max(0, Number(assistantBaseline) || 0)
  return `(() => {
    const baseline = ${baseline};
    ${responseTurnLookupSource()}
    // The stop-button testid is the primary "still generating/reasoning"
    // signal, but a renamed/restructured control must never read as "idle" —
    // that misreading is what makes the automatic recovery reload above
    // interrupt a genuinely still-running response. ".result-streaming" is
    // ChatGPT's own longstanding marker on the assistant message while its
    // text/reasoning is still being produced, independent of the button's
    // current testid/label.
    const stop = document.querySelector('button[data-testid="stop-button"], button[data-testid*="stop-button" i], button:has(svg.icon-primary-action path[d^="M4.5 5.75"])')
      || document.querySelector('.result-streaming, [class*="result-streaming" i]');
    const failed = document.querySelector('[data-testid="conversation-turn-error"] button,button[data-testid="retry-button"],[data-testid="message-error"] button');
    ${composerLookupSource()}
    const composerReady = Boolean(composer);
    // A reloaded long conversation renders only its latest turns, so the count
    // can fall to or below the baseline taken at submit. The author of the last
    // rendered turn still tells whether the answer to the latest user turn is there.
    return { assistantCount, lastRole, thinking: Boolean(stop), failed: Boolean(failed), composerReady, complete: Boolean(assistantCount > baseline && lastRole === 'assistant' && !stop && !failed && composerReady) };
  })()`
}

