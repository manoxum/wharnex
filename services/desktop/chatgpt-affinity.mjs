export function createChatGPTAffinityTracker(linkedURL = '') {
  const boundURL = normalizeConversationURL(linkedURL)
  return {
    phase: boundURL ? 'bound' : 'unbound',
    boundURL,
    candidateURL: '',
    homeSeen: false,
    submitted: false,
  }
}

export function syncChatGPTAffinity(tracker, linkedURL = '', homeSeen = false) {
  const boundURL = normalizeConversationURL(linkedURL)
  tracker.boundURL = boundURL
  tracker.candidateURL = ''
  tracker.homeSeen = boundURL ? false : Boolean(homeSeen)
  tracker.submitted = false
  tracker.phase = boundURL ? 'bound' : 'armed'
  return tracker
}

export function markChatGPTAffinitySubmitted(tracker) {
  if (tracker?.phase === 'armed') tracker.submitted = true
  return tracker
}

export function observeChatGPTAffinity(tracker, observation = {}) {
  if (!tracker) return ''
  if (observation.home === true && tracker.phase === 'armed') tracker.homeSeen = true
  const conversationURL = normalizeConversationURL(observation.conversationUrl)
  if (!conversationURL || tracker.phase !== 'armed' || !tracker.homeSeen || !tracker.submitted) return ''
  return conversationURL
}

export function settleChatGPTAffinity(tracker, conversationURL) {
  const candidateURL = normalizeConversationURL(conversationURL)
  if (!candidateURL || tracker?.phase !== 'armed' || !tracker.homeSeen || !tracker.submitted) return ''
  tracker.candidateURL = candidateURL
  tracker.phase = 'candidate'
  return candidateURL
}

export function isChatGPTAffinityAwaitingSettlement(tracker) {
  return Boolean(tracker && tracker.phase === 'armed' && !tracker.boundURL && tracker.homeSeen && tracker.submitted)
}

export function shouldPreserveChatGPTAffinityNavigation(tracker) {
  return Boolean(tracker && !tracker.boundURL && tracker.submitted && (tracker.phase === 'armed' || tracker.phase === 'candidate'))
}

export function proposeChatGPTAffinity(tracker, conversationURL) {
  const candidateURL = normalizeConversationURL(conversationURL)
  if (!candidateURL) return ''
  if (tracker.boundURL === candidateURL) {
    tracker.phase = 'bound'
    tracker.candidateURL = ''
    tracker.submitted = false
    return candidateURL
  }
  tracker.phase = 'candidate'
  tracker.candidateURL = candidateURL
  tracker.submitted = true
  return candidateURL
}

export function confirmChatGPTAffinity(tracker, conversationURL, visibleConversationURL = '') {
  const confirmedURL = normalizeConversationURL(conversationURL)
  if (!confirmedURL) throw new Error('ChatGPT affinity confirmation requires a concrete conversation URL')
  const visibleURL = normalizeConversationURL(visibleConversationURL)
  if (!tracker.candidateURL && tracker.boundURL && tracker.boundURL !== confirmedURL && visibleURL === confirmedURL) {
    proposeChatGPTAffinity(tracker, confirmedURL)
  }
  if (tracker.candidateURL && tracker.candidateURL !== confirmedURL) throw new Error('ChatGPT affinity confirmation does not match the active candidate')
  if (!tracker.candidateURL && tracker.boundURL && tracker.boundURL !== confirmedURL) throw new Error('ChatGPT affinity confirmation conflicts with the current binding')
  tracker.phase = 'bound'
  tracker.boundURL = confirmedURL
  tracker.candidateURL = ''
  tracker.homeSeen = false
  tracker.submitted = false
  return confirmedURL
}

export function rejectChatGPTAffinity(tracker, conversationURL) {
  const rejectedURL = normalizeConversationURL(conversationURL)
  if (tracker.candidateURL && rejectedURL && tracker.candidateURL !== rejectedURL) return tracker
  tracker.candidateURL = ''
  tracker.homeSeen = false
  tracker.submitted = false
  tracker.phase = tracker.boundURL ? 'bound' : 'armed'
  return tracker
}

export function publicChatGPTAffinity(tracker) {
  return {
    affinityPhase: tracker?.phase || 'unbound',
    boundConversationUrl: tracker?.boundURL || '',
    bindingCandidate: tracker?.candidateURL || '',
  }
}

function normalizeConversationURL(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  try {
    const url = new URL(text)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || (host !== 'chatgpt.com' && !host.endsWith('.chatgpt.com'))) return ''
    const match = /^\/c\/([^/]+)(?:\/.*)?$/.exec(url.pathname)
    const id = match?.[1] || ''
    return id && !/^WEB(?::|%3A)/i.test(id) ? `https://chatgpt.com/c/${id}` : ''
  } catch { return '' }
}
