// Desktop security boundary: every untrusted value crossing IPC, navigation or
// download is validated through these named contracts.
export {
  sanitizeSessionId, sanitizeChatCacheKey, sanitizeOptionalChatCacheKey, sanitizeAttachmentFilename,
  decodeUserAttachment, chatInputSettleDelay, normalizeBounds, sanitizeDiagnosticURL,
} from './input.mjs'
export {
  requireLocalHTTPURL, contextBundleURL, isHTTPS, isTrustedChatGPTOrigin, requireTrustedChatGPTURL,
  externalAuthProvider, isChatGPTAuthURL, sanitizeChatGPTAuthMode, chatGPTNavigationDisposition,
} from './origins.mjs'
export { resolveLinuxOzonePlatform, chromeCompatibleUserAgent } from './platform.mjs'
export {
  wharnessBundleRequestIdFromFilename, BundleOwnershipError, canonicalWharnexBundleDownload,
  validateWharnessBundleDownload, wharnessPlanRequestIdFromFilename, validateWharnessPlanFile,
} from './bundle-files.mjs'
