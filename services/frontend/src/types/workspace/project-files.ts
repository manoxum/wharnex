export type FileEntry = {
  path: string
  name: string
  kind: 'file' | 'directory'
  size: number
}

export type WorkspaceFile = {
  path: string
  content: string
  sha256: string
  size: number
}

export type WorkspaceSearchOptions = {
  query: string
  case_sensitive: boolean
  regex: boolean
  whole_word: boolean
  fuzzy: boolean
  limit?: number
}

export type WorkspaceSearchMatch = {
  path: string
  line: number
  column: number
  preview: string
}

export type WorkspaceSearchResult = {
  matches: WorkspaceSearchMatch[]
  truncated: boolean
}


export type ProjectConfig = {
  version: number
  project: { name: string }
  context: {
    auto_exclude: boolean
    max_file_bytes: number
    include: string[]
    include_overrides?: string[]
    exclude: string[]
  }
}

export type ProjectProvision = {
  project_path: string
  config_file: string
  submodules?: string
}
