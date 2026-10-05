import { chatgptConversationURL } from '../../../../lib/desktop/bridge/desktop'
import { confirmDialog } from '../../../../lib/desktop/bridge/appDialog'
import { expectedResponseBundleName } from '../../../../lib/artifacts/bundles/bundlename'
import { errorMessage } from '../../../../lib/workspace/dialogs/errorMessage'
import { chatgptWriteInProgressNotice } from '../../../../lib/chat/transport/chatgptWriteProgress'

type RecoveryOptions = {
  bridge: WharnessDesktopBridge
  pendingRequestId: string
  chatId: string
  chatTitle: string
  chatgptUrl?: string
  visibleURL: string
  sessionId?: string
  recoveryBootstrap?: string
  chatHash?: string
  requestedAt?: string
  onResendPendingRequest?: (requestId: string) => Promise<void>
  setNotice: (notice: string) => void
}

export async function continuePendingRequest(options: RecoveryOptions) {
  const { bridge, pendingRequestId, chatId, chatTitle, chatgptUrl, visibleURL, sessionId, recoveryBootstrap, chatHash, requestedAt, onResendPendingRequest, setNotice } = options
  try {
    let result = await bridge.chatgpt.continueExpectedBundle(chatId, pendingRequestId)
    if (!result.ok && result.reason === 'write_in_progress') {
      setNotice(chatgptWriteInProgressNotice)
      return
    }
    if (!result.ok && result.reason === 'not_supervised') {
      const conversation = chatgptConversationURL(chatgptUrl || visibleURL)
      if (sessionId && !conversation && onResendPendingRequest) {
        await onResendPendingRequest(pendingRequestId)
        setNotice('O pedido completo persistido foi encaminhado para entrega ao ChatGPT.')
        return
      }
      if (!sessionId || !conversation) {
        setNotice(manualContinuationFailure(result.reason))
        return
      }
      const resumed = await bridge.chatgpt.resumeExpectedBundle({
        cacheKey: chatId,
        sessionId,
        requestId: pendingRequestId,
        url: conversation,
        recoveryBootstrap: recoveryBootstrap || '',
        expectedFilename: expectedResponseBundleName(recoveryBootstrap || '', pendingRequestId),
        chatTitle,
        chatHash,
        requestedAt,
      })
      if (!resumed.ok && resumed.reason === 'write_in_progress') {
        setNotice(chatgptWriteInProgressNotice)
        return
      }
      if (!resumed.ok && (resumed.reason === 'write_not_submitted' || resumed.reason === 'resend_required')) {
        if (onResendPendingRequest) {
          await onResendPendingRequest(pendingRequestId)
          setNotice('O DOM não confirmou o envio original. O prompt e o bundle completos foram encaminhados para reenvio.')
        } else {
          setNotice('O envio original não chegou ao ChatGPT. Use “Reenviar request” no pedido para enviar novamente o prompt e o bundle completos.')
        }
        return
      }
      result = await bridge.chatgpt.continueExpectedBundle(chatId, pendingRequestId)
    }
    if (result.confirmationRequired) {
      const staleTransport = result.reason === 'transport_stale'
      const confirmed = await confirmDialog({
        title: 'O estado de processamento é ambíguo',
        message: staleTransport
          ? 'O Wharnex detetou um transporte antigo sem atividade enquanto a conversa parece ociosa. Confirme apenas se verificou que a tarefa realmente parou.'
          : 'O ChatGPT ainda mostra um controlo de processamento, mas esse sinal pode estar desatualizado. Confirme apenas se verificou que a tarefa realmente parou.',
        tone: 'warning', confirmLabel: 'Continuar mesmo assim', cancelLabel: 'Aguardar',
      })
      if (!confirmed) return
      result = await bridge.chatgpt.continueExpectedBundle(chatId, pendingRequestId, { force: true })
    }
    if (!result.ok) {
      if (result.reason === 'resend_required' && onResendPendingRequest) {
        await onResendPendingRequest(pendingRequestId)
        setNotice('O DOM não confirmou o turno original com o bundle canónico. O pedido completo foi encaminhado para reenvio, sem enviar “keep continue”.')
        return
      }
      setNotice(manualContinuationFailure(result.reason))
      return
    }
    setNotice(result.reason === 'bundle_already_validated'
      ? `O bundle de ${pendingRequestId} já tinha sido validado.`
      : `Continuação manual enviada para ${pendingRequestId}.`)
  } catch (error) {
    setNotice(errorMessage(error, 'Não foi possível retomar o pedido.'))
  }
}

function manualContinuationFailure(reason?: string) {
  if (reason === 'transport_active') return 'O ChatGPT ainda tem transporte de conversa ativo; o pedido não foi interrompido.'
  if (reason === 'surface_loading') return 'A conversa ChatGPT ainda está a carregar. Aguarde a estabilização antes de retomar.'
  if (reason === 'continuation_in_flight') return 'Já existe uma continuação manual deste pedido em curso.'
  if (reason === 'continuation_failed') return 'A continuação não pôde ser preparada. Consulte o alerta do ChatGPT e tente novamente depois de corrigir a causa indicada.'
  if (reason === 'resend_required') return 'O DOM não confirmou o turno original com o bundle canónico. Use “Reenviar request” para enviar novamente o pedido completo.'
  if (reason === 'not_supervised') return 'A supervisão local deste pedido ainda não foi restaurada nesta conversa.'
  return 'O pedido não foi retomado porque o estado remoto ainda não permite uma continuação segura.'
}
