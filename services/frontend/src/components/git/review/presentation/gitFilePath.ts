export function gitFilePath(path: string) {
  const parts = path.split('/')
  const name = parts.pop() || path
  const directories = parts.slice(-2)
  return { name, parent: `${parts.length > directories.length ? '…/' : ''}${directories.join('/')}` }
}
