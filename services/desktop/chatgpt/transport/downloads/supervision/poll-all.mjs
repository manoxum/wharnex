export function createExpectedBundleSweep({ expectedChatGPTBundles, pollExpectedChatGPTDownloadKey }) {
  async function pollExpectedChatGPTDownloads() {
    const keys = [...expectedChatGPTBundles.keys()]
    await Promise.allSettled(keys.map((key) => pollExpectedChatGPTDownloadKey(key)))
  }

  return { pollExpectedChatGPTDownloads }
}
