import type { FileEntry, GitWorkingFile } from '../../../types'

export type TreeNode = { name: string; path: string; kind: 'file' | 'directory'; children: TreeNode[] }
export type ContextMenu = { x: number; y: number; node: TreeNode }
export type WorkspaceMutation = { kind: 'create'; path: string } | { kind: 'rename'; from: string; to: string } | { kind: 'delete'; path: string }

export function changedDirectoryCounts(files: GitWorkingFile[]) {
  const counts = new Map<string, number>()
  for (const file of files) {
    const parts = file.path.split('/')
    parts.pop()
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      counts.set(current, (counts.get(current) || 0) + 1)
    }
  }
  return counts
}

export function canOpenGitDiff(file?: GitWorkingFile) {
  return Boolean(file && file.kind !== 'submodule' && file.kind !== 'embedded_repository')
}

export function buildTree(entries: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'directory', children: [] }
  const directories = new Map<string, TreeNode>([['', root]])
  for (const entry of entries.filter((item) => item.kind === 'directory').sort((a, b) => a.path.localeCompare(b.path))) ensureDir(root, directories, entry.path)
  for (const entry of entries.filter((item) => item.kind === 'file').sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = entry.path.split('/')
    const name = parts.pop() || entry.name
    const parent = parts.join('/')
    ensureDir(root, directories, parent).children.push({ name, path: entry.path, kind: 'file', children: [] })
  }
  sortTree(root)
  return root.children
}

export function findNode(nodes: TreeNode[], path: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node
    const child = findNode(node.children, path)
    if (child) return child
  }
  return undefined
}

export function withAncestors(current: Set<string>, path: string) {
  const next = new Set(current)
  const parts = path.split('/')
  parts.pop()
  let built = ''
  for (const part of parts) {
    built = built ? `${built}/${part}` : part
    next.add(built)
  }
  return next
}

export function parentPath(path: string) {
  const index = path.lastIndexOf('/')
  return index > -1 ? path.slice(0, index) : ''
}

export function validateLeafName(value: string) {
  const clean = value.trim()
  if (!clean) return 'Introduza um nome.'
  if (clean === '.' || clean === '..' || clean.includes('/') || clean.includes('\\')) return 'Use apenas o nome do ficheiro/pasta, sem /, \\ ou segmentos ..'
  return undefined
}

function ensureDir(root: TreeNode, map: Map<string, TreeNode>, path: string) {
  if (map.has(path)) return map.get(path)!
  let current = root
  let built = ''
  for (const part of path.split('/').filter(Boolean)) {
    built = built ? `${built}/${part}` : part
    let child = map.get(built)
    if (!child) {
      child = { name: part, path: built, kind: 'directory', children: [] }
      current.children.push(child)
      map.set(built, child)
    }
    current = child
  }
  return current
}

function sortTree(node: TreeNode) {
  node.children.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1)
  node.children.forEach(sortTree)
}
