import type { DockerComposeProject, DockerComposeService } from '../types'

export type EditorRuntimeMarkerTone = 'running' | 'warning' | 'error' | 'stopped'

export type EditorRuntimeMarker = {
  id: string
  line: number
  tone: EditorRuntimeMarkerTone
  label: string
}

export function dockerComposeRuntimeMarkers(content: string, project: DockerComposeProject): EditorRuntimeMarker[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const servicesIndex = lines.findIndex((line) => /^\s*services\s*:\s*(?:#.*)?$/.test(line))
  if (servicesIndex < 0) return []
  const servicesIndent = indentation(lines[servicesIndex])
  const sectionEnd = findSectionEnd(lines, servicesIndex + 1, servicesIndent)
  const serviceRows = lines.slice(servicesIndex + 1, sectionEnd)
    .map((line, offset) => ({ line, lineNumber: servicesIndex + offset + 2, indent: indentation(line), key: mappingKey(line) }))
    .filter((row) => row.key && row.indent > servicesIndent)
  const directIndent = serviceRows.length ? Math.min(...serviceRows.map((row) => row.indent)) : undefined
  const byName = new Map(serviceRows.filter((row) => row.indent === directIndent).map((row) => [row.key, row.lineNumber]))
  const projectState = runtimeState(project)
  const markers: EditorRuntimeMarker[] = [{
    id: `compose:${project.name}`,
    line: servicesIndex + 1,
    tone: projectState.tone,
    label: `Docker Compose ${project.name}: ${projectState.label}`,
  }]
  for (const service of project.services ?? []) {
    const line = byName.get(service.name)
    if (!line) continue
    const state = runtimeState(service)
    markers.push({
      id: `compose:${project.name}:${service.name}`,
      line,
      tone: state.tone,
      label: `${service.name}: ${state.label} · ${service.running_count}/${service.container_count} containers${service.error_count ? ` · ${service.error_count} erro` : ''}`,
    })
  }
  return markers
}

function runtimeState(item: Pick<DockerComposeProject, 'container_count' | 'running_count' | 'error_count'> | DockerComposeService) {
  if (item.error_count > 0) return { tone: 'error' as const, label: 'Erro' }
  if (item.container_count > 0 && item.running_count === item.container_count) return { tone: 'running' as const, label: 'A correr' }
  if (item.running_count > 0) return { tone: 'warning' as const, label: 'Parcial' }
  return { tone: 'stopped' as const, label: 'Parado' }
}

function findSectionEnd(lines: string[], start: number, indent: number) {
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim() || /^\s*#/.test(line)) continue
    if (indentation(line) <= indent) return index
  }
  return lines.length
}

function indentation(line: string) {
  return /^\s*/.exec(line)?.[0].replace(/\t/g, '  ').length ?? 0
}

function mappingKey(line: string) {
  const match = /^\s*(?:'([^']+)'|"([^"]+)"|([^:#][^:]*?))\s*:/.exec(line)
  return (match?.[1] || match?.[2] || match?.[3] || '').trim()
}
