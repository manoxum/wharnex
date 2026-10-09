export type BrowserMonitorChat = {
  key: string
  project_path: string
  chat_id: string
  session_id?: string
  title: string
  url: string
  kind: 'workspace' | 'task' | 'planning'
  archived?: boolean
}

type Requester = <T>(path: string, init?: RequestInit) => Promise<T>

export function createBrowserMonitorCatalogApi(request: Requester) {
  return {
    browserMonitorChats: () => request<{ chats: BrowserMonitorChat[] }>('/api/browser-monitor/chats'),
  }
}
