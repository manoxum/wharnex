// The current provider uses an agent-turn start marker instead of author-role
// wrappers. Only structural identity and order are read, never message text.
export function responseTurnLookupSource() {
  return `
    const legacyAnswers = document.querySelectorAll('[data-message-author-role="assistant"]');
    const markers = document.querySelectorAll('[data-chatgpt-agent-turn-start]');
    const assistantCount = legacyAnswers.length || markers.length;
    const turns = document.querySelectorAll('[data-message-author-role]');
    let lastRole = turns.length ? String(turns[turns.length - 1].getAttribute('data-message-author-role') || '') : '';
    if (!lastRole && markers.length) {
      const lastMarker = markers[markers.length - 1];
      const users = document.querySelectorAll('[class~="group/user-message"]');
      const lastUser = users[users.length - 1];
      if (lastUser) lastRole = (lastMarker.compareDocumentPosition(lastUser) & 4) ? 'user' : 'assistant';
    }
  `
}
