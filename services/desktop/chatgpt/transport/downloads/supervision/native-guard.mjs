export function checkExpectedNativeGuard(context, snapshot) {
  const { key, entry, expected, requestId, filename, initialWC, url, boundURL } = snapshot
  const fail = (reason) => ({ reason, wc: null })
  if (!requestId || !filename || context.expectedChatGPTBundles.get(key) !== expected || expected.requestId !== requestId || expected.filename !== filename) return fail('expectation')
  if (context.chatgptViews.get(key) !== entry) return fail('slot')
  if (entry.loading) return fail('loading')
  if (entry.externalAuthProvider || entry.authWindowOpen || entry.embeddedAuthActive) return fail('login')
  if (Number(entry.transportPreparationCount || 0) > 0) return fail('preparing')
  if (context.chatgptTransportModes.get(key) === 'manual') return fail('manual')
  if (entry.humanAction?.active && !['transport', 'stalled'].includes(entry.humanAction.kind)) return fail('human-gate')
  if (context.hasPendingChatGPTComments(key)) return fail('queued-comment')
  if (context.pendingChatGPTBundleDeliveries.has(requestId)) return fail('pending-delivery')
  if (context.recentlyDeliveredChatGPTBundleRequestId(requestId)) return fail('already-delivered')
  if (Date.now() - expected.armedAt > context.EXPECTED_BUNDLE_TTL_MS) return fail('expired')
  if (entry.affinity?.boundURL !== boundURL) return fail('affinity')
  if (!context.chatGPTSupervisorOwnsExpectedResponse(key, requestId, url)) return fail('supervisor-lease')
  let wc
  try { wc = context.requireOwnedChatGPTEntry(key, entry).wc } catch { return fail('owned-entry') }
  if (wc !== initialWC || wc.isDestroyed()) return fail('webcontents')
  if (wc.getURL() !== url) return fail('url-changed')
  if (!context.isTrustedChatGPTOrigin(url)) return fail('origin')
  return { wc, reason: '' }
}
