import type { ArtifactDirectiveCandidate, ComposerDirective, DirectiveSuggestion, ReferenceableProject } from './composerDirectives'

type AttachedPathFiles = { root: string; files: string[] }

type IndexedSources = {
  projectFiles: string[]
  projects: ReferenceableProject[]
  attachedPaths: AttachedPathFiles[]
  chatFiles: ArtifactDirectiveCandidate[]
  libraryFiles: ArtifactDirectiveCandidate[]
  todoItems: ArtifactDirectiveCandidate[]
}

function rank(values: string[], needle: string, limit = 8) {
  const query = needle.toLowerCase()
  const basename = (value: string) => value.split('/').pop()?.toLowerCase() || value.toLowerCase()
  return values.filter((value) => !query || value.toLowerCase().includes(query))
    .sort((left, right) => Number(!basename(left).startsWith(query)) - Number(!basename(right).startsWith(query)) || left.length - right.length || left.localeCompare(right))
    .slice(0, limit)
}

function visibleDirectories(paths: string[]) {
  const directories = new Set<string>()
  for (const file of paths) {
    const parts = file.split('/').filter(Boolean)
    for (let index = 1; index < parts.length; index += 1) directories.add(parts.slice(0, index).join('/'))
  }
  return directories
}

function matchingVisiblePaths(paths: string[], query: string) {
  const files = new Set(paths)
  return rank([...visibleDirectories(paths), ...files], query).map((path) => ({ path, kind: files.has(path) ? 'file' as const : 'directory' as const }))
}

function visiblePathExists(paths: string[], target: string) {
  const clean = target.replace(/\/+$/, '')
  return paths.some((path) => path === clean || path.startsWith(`${clean}/`))
}

function scopePaths(paths: string[], selections: string[]) {
  const scoped = new Set<string>()
  for (const selection of selections) {
    const clean = selection.replace(/\/+$/, '')
    let matched = false
    for (const path of paths) {
      if (path === clean || path.startsWith(`${clean}/`)) { scoped.add(path); matched = true }
    }
    if (!matched && clean) scoped.add(clean)
  }
  return [...scoped]
}

function indexedArtifacts(candidates: ArtifactDirectiveCandidate[], directives: ComposerDirective[], kind: ComposerDirective['kind']) {
  const selected = directives.filter((item) => item.kind === kind)
  return selected.map((directive) => candidates.find((candidate) => candidate.value === directive.value) || ({
    value: directive.value,
    label: directive.path || directive.value,
    detail: `@${kind} já indexado no composer`,
  }))
}

function indexedSources(projectFiles: string[], projects: ReferenceableProject[], attachedPaths: AttachedPathFiles[], chatFiles: ArtifactDirectiveCandidate[], libraryFiles: ArtifactDirectiveCandidate[], todoItems: ArtifactDirectiveCandidate[], directives: ComposerDirective[]): IndexedSources {
  const fileSelections = directives.filter((item) => item.kind === 'file').map((item) => item.path)
  const refGroups = new Map<string, { base?: ReferenceableProject; selections: string[] }>()
  for (const directive of directives.filter((item) => item.kind === 'ref')) {
    const key = directive.project.toLowerCase()
    const current = refGroups.get(key) || { base: projects.find((item) => item.name.toLowerCase() === key), selections: [] }
    current.selections.push(directive.path)
    refGroups.set(key, current)
  }
  const selectedProjects = [...refGroups.entries()].map(([key, entry]) => {
    const name = entry.base?.name || directives.find((item) => item.kind === 'ref' && item.project.toLowerCase() === key)?.project || key
    const wholeProject = entry.selections.some((path) => !path)
    const files = wholeProject ? (entry.base?.files || []) : scopePaths(entry.base?.files || [], entry.selections.filter(Boolean))
    return { name, projectPath: entry.base?.projectPath || '', attached: entry.base?.attached || false, files }
  })
  const selectedAttachRoots = new Set(directives.filter((item) => item.kind === 'attach').map((item) => item.path))
  return {
    projectFiles: scopePaths(projectFiles, fileSelections),
    projects: selectedProjects,
    attachedPaths: [...selectedAttachRoots].map((root) => attachedPaths.find((item) => item.root === root) || { root, files: [] }),
    chatFiles: indexedArtifacts(chatFiles, directives, 'chat'),
    libraryFiles: indexedArtifacts(libraryFiles, directives, 'lib'),
    todoItems: indexedArtifacts(todoItems, directives, 'todo'),
  }
}

function rankArtifacts(candidates: ArtifactDirectiveCandidate[], needle: string) {
  const query = needle.toLowerCase()
  return candidates.filter((candidate) => !query || candidate.label.toLowerCase().includes(query) || candidate.detail?.toLowerCase().includes(query))
    .sort((left, right) => Number(!left.label.toLowerCase().startsWith(query)) - Number(!right.label.toLowerCase().startsWith(query)) || left.label.localeCompare(right.label, 'pt'))
    .slice(0, 10)
}

function targetSuggestions(paths: string[], query: string, prefix: string, sourceLabel: string): DirectiveSuggestion[] {
  return matchingVisiblePaths(paths, query).map((target) => ({ value: `${prefix}${target.path}`, label: target.kind === 'directory' ? `${target.path}/` : target.path, detail: `${target.kind === 'directory' ? 'Diretório' : 'Ficheiro'} · ${sourceLabel}`, sourceIcon: target.kind === 'directory' ? 'folder' : 'file' }))
}

function countDetail(paths: string[]) { return `${paths.length} ficheiro(s) · ${visibleDirectories(paths).size} diretório(s)` }
function filteredSources(sources: DirectiveSuggestion[], query: string) { const needle = query.toLowerCase(); return sources.filter((source) => !needle || `${source.value} ${source.label} ${source.detail || ''}`.toLowerCase().includes(needle)) }

export function seeSuggestions(value: string, projectFiles: string[], projects: ReferenceableProject[], attachmentNames: string[], attachedPaths: AttachedPathFiles[], chatFiles: ArtifactDirectiveCandidate[], libraryFiles: ArtifactDirectiveCandidate[], todoItems: ArtifactDirectiveCandidate[], indexedDirectives?: ComposerDirective[]): DirectiveSuggestion[] {
  const restricted = indexedDirectives !== undefined
  const sources = restricted ? indexedSources(projectFiles, projects, attachedPaths, chatFiles, libraryFiles, todoItems, indexedDirectives) : { projectFiles, projects: projects.filter((item) => item.attached), attachedPaths, chatFiles, libraryFiles, todoItems }
  const parts = value.split('|')
  if (parts.length === 1) {
    const rows: DirectiveSuggestion[] = restricted ? [
      ...(attachmentNames.length ? [{ value: 'upload|', label: 'Anexos diretos', detail: `${attachmentNames.length} ficheiro(s) anexado(s)`, continues: true, sourceIcon: 'file' as const }] : []),
      ...(sources.projectFiles.length ? [{ value: 'file|', label: '@file Projeto atual', detail: countDetail(sources.projectFiles), continues: true, sourceIcon: 'workspace' as const }] : []),
      ...sources.projects.map((project) => ({ value: `ref|${project.name}|`, label: `@ref ${project.name}`, detail: countDetail(project.files), continues: true, sourceIcon: 'link' as const })),
      ...(sources.libraryFiles.length ? [{ value: 'lib|', label: '@lib Biblioteca', detail: `${sources.libraryFiles.length} artefacto(s) indexado(s)`, continues: true, sourceIcon: 'file' as const }] : []),
      ...(sources.chatFiles.length ? [{ value: 'chat|', label: '@chat Ficheiros do chat', detail: `${sources.chatFiles.length} artefacto(s) indexado(s)`, continues: true, sourceIcon: 'file' as const }] : []),
      ...(sources.todoItems.length ? [{ value: 'todo|', label: '@todo TODOs do projeto', detail: `${sources.todoItems.length} TODO(s) indexado(s)`, continues: true, sourceIcon: 'link' as const }] : []),
      ...sources.attachedPaths.map((attachment) => ({ value: `attach|${attachment.root}|`, label: `@attach ${attachment.root.split('/').filter(Boolean).pop() || attachment.root}`, detail: countDetail(attachment.files), continues: true, sourceIcon: 'folder' as const })),
    ] : [
      ...(projectFiles.length ? [{ value: 'file|', label: '@file Projeto atual', detail: countDetail(projectFiles), continues: true, sourceIcon: 'workspace' as const }] : []),
      ...(chatFiles.length ? [{ value: 'chat|', label: '@chat Ficheiros do chat', detail: `${chatFiles.length} artefacto(s) indexado(s)`, continues: true, sourceIcon: 'file' as const }] : []),
      ...(libraryFiles.length ? [{ value: 'lib|', label: '@lib Biblioteca', detail: `${libraryFiles.length} artefacto(s) disponível(is)`, continues: true, sourceIcon: 'file' as const }] : []),
      ...(attachmentNames.length ? [{ value: 'upload|', label: 'Anexos diretos', detail: `${attachmentNames.length} ficheiro(s) anexado(s)`, continues: true, sourceIcon: 'file' as const }] : []),
      ...projects.filter((project) => project.attached).map((project) => ({ value: `ref|${project.name}|`, label: `@ref ${project.name}`, detail: countDetail(project.files), continues: true, sourceIcon: 'link' as const })),
      ...attachedPaths.map((attachment) => ({ value: `attach|${attachment.root}|`, label: `@attach ${attachment.root.split('/').filter(Boolean).pop() || attachment.root}`, detail: countDetail(attachment.files), continues: true, sourceIcon: 'folder' as const })),
    ]
    return filteredSources(rows, value)
  }
  const source = parts[0]
  if ((source === 'file' || source === 'project') && parts.length === 2) return targetSuggestions(sources.projectFiles, parts[1], `${source}|`, source === 'file' ? '@file Projeto atual' : 'Projeto atual')
  if (source === 'chat') return rankArtifacts(sources.chatFiles, value.slice(5)).map((item) => ({ ...item, value: `chat|${item.value}`, detail: [item.detail, '@chat'].filter(Boolean).join(' · ') }))
  if (source === 'lib') return rankArtifacts(sources.libraryFiles, value.slice(4)).map((item) => ({ ...item, value: `lib|${item.value}`, detail: [item.detail, '@lib'].filter(Boolean).join(' · ') }))
  if (source === 'todo') return rankArtifacts(sources.todoItems, value.slice(5)).map((item) => ({ ...item, value: `todo|${item.value}`, detail: [item.detail, '@todo'].filter(Boolean).join(' · ') }))
  if (source === 'upload' && parts.length === 2) return rank(attachmentNames, parts[1]).map((name) => ({ value: `upload|${name}`, label: name, detail: 'Anexo direto' }))
  if (source === 'ref' && parts.length === 3) { const project = sources.projects.find((item) => item.name.toLowerCase() === parts[1].toLowerCase()); return project ? targetSuggestions(project.files, parts[2], `ref|${project.name}|`, `@ref ${project.name}`) : [] }
  if (source === 'attach' && parts.length === 3) { const attachment = sources.attachedPaths.find((item) => item.root === parts[1]); return attachment ? targetSuggestions(attachment.files, parts[2], `attach|${attachment.root}|`, `@attach ${attachment.root.split('/').filter(Boolean).pop() || attachment.root}`) : [] }
  return []
}

function pathCovered(selection: string, target: string) { const clean = selection.replace(/\/+$/, ''); return !clean || target === clean || target.startsWith(`${clean}/`) }

export function seeDirectiveAvailable(directive: ComposerDirective, projectFiles: string[], projects: ReferenceableProject[], attachmentNames: string[], attachedPaths: AttachedPathFiles[], chatFiles: ArtifactDirectiveCandidate[] = [], libraryFiles: ArtifactDirectiveCandidate[] = [], todoItems: ArtifactDirectiveCandidate[] = [], indexedDirectives?: ComposerDirective[]) {
  if (directive.kind !== 'see') return false
  const parts = directive.value.split('|')
  const source = parts.length === 1 ? 'upload' : parts[0]
  if (indexedDirectives !== undefined && source !== 'upload') {
    const backed = source === 'file' || source === 'project' ? indexedDirectives.some((item) => item.kind === 'file' && pathCovered(item.path, directive.path))
      : source === 'chat' ? indexedDirectives.some((item) => item.kind === 'chat' && item.value === directive.value.slice(5))
        : source === 'lib' ? indexedDirectives.some((item) => item.kind === 'lib' && item.value === directive.value.slice(4))
          : source === 'todo' ? indexedDirectives.some((item) => item.kind === 'todo' && item.value === directive.value.slice(5))
            : source === 'ref' ? indexedDirectives.some((item) => item.kind === 'ref' && item.project.toLowerCase() === directive.project.toLowerCase() && pathCovered(item.path, directive.path))
              : source === 'attach' ? indexedDirectives.some((item) => item.kind === 'attach' && item.path === directive.project) : false
    if (!backed) return false
  }
  if (source === 'upload') return attachmentNames.some((name) => name.toLowerCase() === directive.path.toLowerCase())
  if (source === 'file' || source === 'project') return visiblePathExists(projectFiles, directive.path) || indexedDirectives?.some((item) => item.kind === 'file' && item.path === directive.path) === true
  if (source === 'chat') return chatFiles.some((item) => item.value === directive.value.slice(5)) || indexedDirectives?.some((item) => item.kind === 'chat' && item.value === directive.value.slice(5)) === true
  if (source === 'lib') return libraryFiles.some((item) => item.value === directive.value.slice(4)) || indexedDirectives?.some((item) => item.kind === 'lib' && item.value === directive.value.slice(4)) === true
  if (source === 'todo') return todoItems.some((item) => item.value === directive.value.slice(5)) || indexedDirectives?.some((item) => item.kind === 'todo' && item.value === directive.value.slice(5)) === true
  if (source === 'ref') { const project = projects.find((item) => item.name.toLowerCase() === directive.project.toLowerCase()); return Boolean(project && visiblePathExists(project.files, directive.path)) || indexedDirectives?.some((item) => item.kind === 'ref' && item.project.toLowerCase() === directive.project.toLowerCase() && item.path === directive.path) === true }
  if (source === 'attach') { const attachment = attachedPaths.find((item) => item.root === directive.project); return Boolean(attachment && visiblePathExists(attachment.files, directive.path)) }
  return false
}
