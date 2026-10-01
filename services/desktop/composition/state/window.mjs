export function createWindowCollections(ProjectWindowRegistry) {
  return {
    desktopWindows: new Map(),
    projectWindowRegistry: new ProjectWindowRegistry(),
  }
}
