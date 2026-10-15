export function createResponseProbe(context) {
  const {
    hydrateExpectedChatAgentBundle, chatGPTSupervisorOwnsExpectedResponse, CHAT_AGENT_AWAIT_PROBE_MS, recentlyDeliveredChatGPTBundleRequestId, pendingChatGPTBundleDeliveries, disarmExpectedChatGPTBundle,
    sameConversationURL, orchestratorTaskChat, paceChatGPTWorkerNavigation, loadOwnedChatGPTURL, waitForChatGPTSurfaceReady, executeChatGPTDOMScript,
    chatGPTHumanActionScript, noteChatGPTRateLimitGate, chatAgentRateLimitDelayMs, chatGPTHumanActionMessage, chatAgentKeepFlowingEnabled, chooseChatGPTRecoveryAction,
    performChatGPTRecoveryAction, chatGPTResponseCompletionScript, PROCESSING_SIGNAL_GRACE_MS, enqueueChatAgentContinuation, DOM_DOWNLOAD_RETRY_MS, chatGPTExpectedDownloadScript,
    setRecentExpectedDownload, AWAIT_STALL_ATTENTION_MS, captureChatGPTProcessingDuration, DOWNLOAD_INFLIGHT_TIMEOUT_MS, noteChatGPTRecoveryAssistantCount, isChatGPTAffinityAwaitingSettlement,
    BUNDLE_UNOBSERVED_SETTLE_MS, BUNDLE_COMPLETION_CONFIRM_MS,
  } = context

  async function probeChatAgentResponse(task, entry, key, payload, conversationURL) {
    const expected = await hydrateExpectedChatAgentBundle(key, task, payload)
    // The Supervisor that submitted this request is already reading the page it
    // never left, so this lease attempted nothing and stands back. It stands back
    // at the observation cadence rather than at the DOM poll: a Worker re-claiming
    // every two seconds for the whole life of a supervised response is a claim,
    // a start and a settle per cycle against work another pool owns.
    if (chatGPTSupervisorOwnsExpectedResponse(key, expected.requestId, conversationURL)) {
      return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true, error: 'visible Supervisor owns response supervision' }
    }
    if (recentlyDeliveredChatGPTBundleRequestId(expected.requestId) || pendingChatGPTBundleDeliveries.has(expected.requestId)) {
      disarmExpectedChatGPTBundle(key, expected.requestId)
      return { status: 'done' }
    }
    if (conversationURL && !sameConversationURL(entry.view.webContents.getURL(), conversationURL)) {
      // A Worker pinned to an Orchestrator task plays that task's Supervisor
      // (adr/ADR-0081): when it is not on the task's conversation (a new or
      // parked page) it returns to it, as a Supervisor never leaves its own.
      if (orchestratorTaskChat(task)) {
        await paceChatGPTWorkerNavigation()
        await loadOwnedChatGPTURL(key, entry, conversationURL, 'orchestrator-task-return')
      } else {
        // Nothing was attempted: the slot simply was not where this probe needed it.
        // Charging the attempt budget for a scheduling artefact is what retired 23
        // healthy supervisions with "exhausted maximum attempts while waiting".
        return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true, error: 'resident worker is no longer on the expected conversation' }
      }
    }
    // AWAIT_RESPONSE is deliberately passive: observe the already-resident page,
    // never focus the composer, reload, or navigate a healthy conversation.
    await waitForChatGPTSurfaceReady(key, entry)
    const health = await executeChatGPTDOMScript(key, entry, 'worker-health', chatGPTHumanActionScript())
    // A gated account is not this supervision's fault and must not spend its
    // attempt budget: hand the slot back and let the durable cooldown expire.
    if (noteChatGPTRateLimitGate(key, health)) {
      return { status: 'waiting', delayMs: chatAgentRateLimitDelayMs(), observation: true, error: 'ChatGPT rate-limit gate is active' }
    }
    if (health?.required === true) return { status: 'attention', providerWide: true, error: chatGPTHumanActionMessage(String(health.kind || 'verification')) }
    const keepFlowing = !expected.rehydrating && chatAgentKeepFlowingEnabled(Number(String(entry.slotId || '').replace('worker-', '')), task)
    if (keepFlowing) {
      const faultAction = chooseChatGPTRecoveryAction(expected.recovery, {}, Date.now(), { faultOnly: true })
      if (faultAction) {
        await performChatGPTRecoveryAction(key, expected, entry, faultAction)
        return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true, error: `Keep flowing recovery: ${faultAction.reason}` }
      }
    }
    const completion = await entry.view.webContents.executeJavaScript(chatGPTResponseCompletionScript(expected.assistantBaseline), true)
    const now = Date.now()
    // A reloaded long conversation renders fewer turns than it had at submit, so
    // the count stays at or below the baseline and the answer never read as
    // complete: supervision declared "no structural sign" and the request was
    // sent again. When the page is idle and its last rendered turn is the
    // assistant's, the answer is there; the baseline follows the rendered page.
    if (completion && completion.thinking !== true && completion.failed !== true && completion.composerReady === true &&
        completion.lastRole === 'assistant' && Number(completion.assistantCount || 0) > 0 &&
        Number(completion.assistantCount || 0) <= Number(expected.assistantBaseline || 0)) {
      expected.assistantBaseline = Number(completion.assistantCount) - 1
      completion.complete = true
      console.warn(`[chatgpt-supervision] baseline-rebased key=${key} request=${expected.requestId} rendered=${completion.assistantCount}`)
    }
    // While the page is provably still generating, this lease observed healthy
    // progress rather than attempting anything, so it must not spend the attempt
    // budget. Supervision is bounded by evidence of trouble, never by a clock
    // that runs out while the model is visibly still working.
    if (completion?.thinking === true) {
      expected.processingObservedAt = expected.processingObservedAt || now
      expected.processingAbsentSince = 0
      expected.settledAt = 0
      expected.progressAt = now
      return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true }
    }
    if (expected.processingObservedAt && !expected.processingAbsentSince) expected.processingAbsentSince = now
    const responseStarted = Number(completion?.assistantCount || 0) > Number(expected.assistantBaseline || 0)
    const processingInterrupted = Boolean(
      !expected.rehydrating && expected.processingObservedAt
      && expected.processingAbsentSince
      && !responseStarted
      && completion?.composerReady === true
      && completion?.failed !== true
      && now - expected.processingAbsentSince >= PROCESSING_SIGNAL_GRACE_MS
    )
    if (processingInterrupted) {
      return enqueueChatAgentContinuation(task, key, expected, payload, conversationURL, now, 'processing-interrupted')
    }
    if (completion?.complete !== true) {
      expected.settledAt = 0
      // Neither generating nor complete. The exact response ZIP may still be in
      // the conversation, delivered earlier in a turn this reloaded page counts
      // differently: its name carries the request id, so it is looked for
      // anywhere before the page is judged silent (adr/ADR-0078).
      if (!expected.downloadInFlight && completion?.thinking !== true && now - Number(expected.lastDOMClick || 0) >= DOM_DOWNLOAD_RETRY_MS) {
        const anywhere = await entry.view.webContents.executeJavaScript(chatGPTExpectedDownloadScript(expected.filename, 0, false, true), true)
        if (anywhere) {
          expected.downloadInFlight = true
          expected.lastDOMClick = now
          expected.progressAt = now
          setRecentExpectedDownload({ key, requestId: expected.requestId, at: now })
          console.warn(`[chatgpt-supervision] exact-bundle-found key=${key} request=${expected.requestId} rendered=${Number(completion?.assistantCount || 0)} baseline=${Number(expected.assistantBaseline || 0)}`)
          return { status: 'waiting', delayMs: DOM_DOWNLOAD_RETRY_MS, observation: true }
        }
      }
      // Neither generating nor complete. This is a passive read of an ambiguous
      // page, not an attempt, so it must not spend the budget either — but it is
      // also the one state that carries no evidence of progress, so it is bounded
      // by its own stall deadline instead of supervising indefinitely.
      if (now - Number(expected.progressAt || now) >= AWAIT_STALL_ATTENTION_MS) {
        console.warn(`[chatgpt-supervision] stall key=${key} request=${expected.requestId} rendered=${Number(completion?.assistantCount || 0)} baseline=${Number(expected.assistantBaseline || 0)} lastRole=${String(completion?.lastRole || '-')} thinking=${completion?.thinking === true} failed=${completion?.failed === true} composerReady=${completion?.composerReady === true} onConversation=${sameConversationURL(entry.view.webContents.getURL(), conversationURL)}`)
        return {
          status: 'attention',
          error: `ChatGPT deixou de dar sinal estrutural para ${expected.filename} durante ${Math.round(AWAIT_STALL_ATTENTION_MS / 60_000)} minutos; a conversa precisa de verificação humana.`,
        }
      }
      return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true }
    }
    if (!expected.rehydrating) expected.progressAt = now
    await captureChatGPTProcessingDuration(entry, expected)
    if (!expected.downloadInFlight && (!keepFlowing || Number(expected.invalidBundleCount || 0) === 0)) {
      const clickMode = await entry.view.webContents.executeJavaScript(chatGPTExpectedDownloadScript(expected.filename, expected.assistantBaseline, false, Boolean(expected.rehydrating)), true)
      if (clickMode) {
        expected.downloadInFlight = true
        expected.lastDOMClick = Date.now()
        expected.progressAt = expected.lastDOMClick
        setRecentExpectedDownload({ key, requestId: expected.requestId, at: Date.now() })
        return { status: 'waiting', delayMs: DOM_DOWNLOAD_RETRY_MS, observation: true }
      }
    }
    // A click was already fired for this exact bundle and Chromium has not yet
    // reported will-download/done for it. Treating this tick as "complete
    // without a bundle" below would race that in-flight click and enqueue an
    // automatic continuation for a request that already produced a bundle,
    // moments before it was downloaded. Wait for it to resolve, bounded in case
    // the click missed a real download affordance and will-download never fires.
    if (expected.downloadInFlight) {
      const pendingMs = now - Number(expected.lastDOMClick || now)
      if (pendingMs < DOWNLOAD_INFLIGHT_TIMEOUT_MS) return { status: 'waiting', delayMs: DOM_DOWNLOAD_RETRY_MS, observation: true }
      expected.downloadInFlight = false
      console.warn(`[chatgpt-bundle-dom] download-stalled key=${key} file=${expected.filename} pendingMs=${pendingMs}`)
    }
    if (expected.rehydrating) {
      if (now - Number(expected.progressAt || now) >= AWAIT_STALL_ATTENTION_MS) {
        return { status: 'attention', error: `A observação passiva não recebeu ${expected.filename}; verifique a conversa vinculada.` }
      }
      return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true }
    }
    if (keepFlowing) {
      noteChatGPTRecoveryAssistantCount(expected.recovery, completion?.assistantCount, now)
      const recoveryAction = chooseChatGPTRecoveryAction(expected.recovery, {
        complete: completion?.complete === true, thinking: false, failed: completion?.failed === true,
        responseStarted: Number(completion?.assistantCount || 0) > Number(expected.assistantBaseline || 0),
        surfaceReady: completion?.composerReady === true, humanActionRequired: entry.humanAction?.active === true,
        awaitingConversationAffinity: isChatGPTAffinityAwaitingSettlement(entry.affinity), transportActive: false,
      }, now)
      if (recoveryAction) {
        await performChatGPTRecoveryAction(key, expected, entry, recoveryAction, completion)
        return { status: 'waiting', delayMs: CHAT_AGENT_AWAIT_PROBE_MS, observation: true, error: `Keep flowing recovery: ${recoveryAction.reason}` }
      }
    }
    // A completion is a single instant of a live page, and ChatGPT satisfies
    // every structural completion condition transiently — between reasoning
    // steps, and in the gap between finishing its text and mounting the file
    // card. Acting on one such sample is what made Wharnex declare "terminou sem
    // disponibilizar" over a response that was still being produced, and then
    // spend a whole continuation request re-asking for work already in progress.
    // A terminal conclusion therefore requires the completion to still hold, with
    // the bundle still absent, after the grace window — and the grace is measured
    // from the moment the generating indicator actually disappeared.
    const idleSince = Math.max(Number(expected.processingAbsentSince || 0), Number(expected.settledAt || 0))
    if (!expected.settledAt) expected.settledAt = now
    // The grace means "the generating indicator went away and stayed away", which
    // is only meaningful once that indicator was actually seen. When it never was,
    // `idleSince` degrades to "the page has looked static since we first looked" —
    // and a page can look static because the turn has not started, because the
    // model is between reasoning phases, or because a tool call is running with no
    // visible marker. Concluding from that is how a response still being composed
    // was declared finished, and it is what made the continuation prompt land on
    // top of a model that was still working.
    const settleWindow = expected.processingObservedAt ? PROCESSING_SIGNAL_GRACE_MS : BUNDLE_UNOBSERVED_SETTLE_MS
    if (!idleSince || now - idleSince < settleWindow) {
      return { status: 'waiting', delayMs: BUNDLE_COMPLETION_CONFIRM_MS, observation: true }
    }
    return enqueueChatAgentContinuation(task, key, expected, payload, conversationURL, now, 'completed-without-bundle')
  }

  return { probeChatAgentResponse }
}
