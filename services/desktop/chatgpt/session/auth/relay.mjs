export async function relayManagedBrowserCookies({ cookies, session, partition, electronCookieDetails }) {
  const chatSession = session.fromPartition(partition)
  let imported = 0
  for (const cookie of cookies || []) {
    const details = electronCookieDetails(cookie)
    if (!details) continue
    try {
      await chatSession.cookies.set(details)
      imported += 1
    } catch {
      // Cookie values and browser errors must never enter the operational log.
      console.warn('[chatgpt-auth] eligible cookie relay skipped')
    }
  }
  if (!imported) throw new Error('O navegador concluiu o login, mas nenhuma credencial ChatGPT pôde ser transferida para a sessão incorporada.')
  await chatSession.flushStorageData()
  return imported
}
