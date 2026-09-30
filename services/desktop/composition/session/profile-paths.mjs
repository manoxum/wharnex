export function createDesktopProfilePaths({ app, path, managedBrowserProfileDirectory }) {
  function chatGPTPartitionPath() {
    return path.join(app.getPath('userData'), 'Partitions', 'wharness-chatgpt')
  }

  function managedAuthProfilePath() {
    return managedBrowserProfileDirectory(app.getPath('userData'))
  }

  function pendingBrowserImportPath() {
    return path.join(app.getPath('userData'), '.wharness-browser-session-import.whbs')
  }

  return { chatGPTPartitionPath, managedAuthProfilePath, pendingBrowserImportPath }
}
