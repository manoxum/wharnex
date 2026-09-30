import { describe, expect, it } from 'vitest'
import { dockerComposeRuntimeMarkers } from './editorRuntimeMarkers'

const project = {
  name: 'demo', container_count: 2, running_count: 1, error_count: 0, stopped_count: 1,
  services: [
    { name: 'api', container_count: 1, running_count: 1, error_count: 0 },
    { name: 'worker', container_count: 1, running_count: 0, error_count: 0 },
  ],
}

describe('dockerComposeRuntimeMarkers', () => {
  it('maps the Compose project and its services onto their YAML lines', () => {
    const markers = dockerComposeRuntimeMarkers([
      'name: demo',
      'services:',
      '  api:',
      '    image: demo/api',
      '  worker:',
      '    image: demo/worker',
      'networks:',
      '  default: {}',
    ].join('\n'), project)

    expect(markers).toEqual([
      { id: 'compose:demo', line: 2, tone: 'warning', label: 'Docker Compose demo: Parcial' },
      { id: 'compose:demo:api', line: 3, tone: 'running', label: 'api: A correr · 1/1 containers' },
      { id: 'compose:demo:worker', line: 5, tone: 'stopped', label: 'worker: Parado · 0/1 containers' },
    ])
  })

  it('does not mistake nested keys for service definitions', () => {
    const markers = dockerComposeRuntimeMarkers([
      'services:',
      '    api:',
      '      labels:',
      '        worker: nested',
      '    worker:',
      '      image: demo/worker',
    ].join('\n'), project)
    expect(markers.map((marker) => marker.line)).toEqual([1, 2, 5])
  })
})
