import * as source10 from '../../../transport/index.mjs'
import * as source19 from '../../../clipboard/index.mjs'
import * as source20 from '../../../observability/index.mjs'

export function createTransportDependencies() {
  return {
    readStoredAttachment: source10.readStoredAttachment, removeStoredChatAttachments: source10.removeStoredChatAttachments, storedAttachmentPath: source10.storedAttachmentPath,
    buildBundleName: source10.buildBundleName, parseBundleName: source10.parseBundleName, safeChatId: source10.safeChatId,
    uploadChatArtifact: source10.uploadChatArtifact, chatInputArchiveFilename: source10.chatInputArchiveFilename, chatInputPartManifest: source10.chatInputPartManifest,
    localChatInputBootstrap: source10.localChatInputBootstrap, writeChatInputTransportArchives: source10.writeChatInputTransportArchives, MAX_CONTEXT_BYTES: source10.MAX_CONTEXT_BYTES,
    MAX_PLAN_BYTES: source10.MAX_PLAN_BYTES, MAX_EXECUTION_BUNDLE_BYTES: source10.MAX_EXECUTION_BUNDLE_BYTES, MAX_MARKDOWN_TRANSLATION_BYTES: source10.MAX_MARKDOWN_TRANSLATION_BYTES,
    MAX_MARKDOWN_TRANSLATION_RESULT_BYTES: source10.MAX_MARKDOWN_TRANSLATION_RESULT_BYTES, MAX_TODO_CLASSIFICATION_BYTES: source10.MAX_TODO_CLASSIFICATION_BYTES, TODO_CLASSIFICATION_TIMEOUT_MS: source10.TODO_CLASSIFICATION_TIMEOUT_MS,
    MAX_UI_TEST_DISCOVERY_REQUEST_BYTES: source10.MAX_UI_TEST_DISCOVERY_REQUEST_BYTES, MAX_UI_TEST_DISCOVERY_BYTES: source10.MAX_UI_TEST_DISCOVERY_BYTES, UI_TEST_DISCOVERY_TIMEOUT_MS: source10.UI_TEST_DISCOVERY_TIMEOUT_MS,
    MARKDOWN_TRANSLATION_TIMEOUT_MS: source10.MARKDOWN_TRANSLATION_TIMEOUT_MS, MARKDOWN_TRANSLATION_POLL_MS: source10.MARKDOWN_TRANSLATION_POLL_MS, MAX_ORCHESTRATOR_PLAN_BYTES: source10.MAX_ORCHESTRATOR_PLAN_BYTES,
    ORCHESTRATOR_PLAN_TIMEOUT_MS: source10.ORCHESTRATOR_PLAN_TIMEOUT_MS, ORCHESTRATOR_PLAN_GENERATING_GRACE_MS: source10.ORCHESTRATOR_PLAN_GENERATING_GRACE_MS, ORCHESTRATOR_PLAN_OBSERVE_AGAIN_MS: source10.ORCHESTRATOR_PLAN_OBSERVE_AGAIN_MS,
    registerClipboardIPC: source19.registerClipboardIPC,
    traceForTask: source20.traceForTask, traceId: source20.traceId, withTrace: source20.withTrace,
  }
}
