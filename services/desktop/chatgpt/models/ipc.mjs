export function registerChatGPTModelIPC({ ipcMain, trustedSender, getChatGPTModels, setChatGPTModel }) {
  for (const [name, operation] of [['get-models', getChatGPTModels], ['set-model', setChatGPTModel]]) {
    ipcMain.handle(`wharnex:chatgpt:${name}`, async (event, request) => operation(request, trustedSender(event)))
  }
}
