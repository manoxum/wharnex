import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DrawioPreview } from './DrawioPreview'

const graph = `<mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="a" value="Cliente" vertex="1" parent="1"><mxGeometry x="10" y="20" width="120" height="60" as="geometry"/></mxCell>
  <mxCell id="b" value="API" style="ellipse" vertex="1" parent="1"><mxGeometry x="220" y="20" width="100" height="60" as="geometry"/></mxCell>
  <mxCell id="e" value="HTTPS" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel>`
const mxfile = `<mxfile compressed="false"><diagram id="main">${graph}</diagram></mxfile>`

function textResponse(text: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: null,
    headers: { get: () => null },
    text: async () => text,
  } as unknown as Response
}

afterEach(() => vi.unstubAllGlobals())

describe('DrawioPreview', () => {
  it.each([
    ['/api/sessions/s1/artifacts/a/entry?path=diagram.drawio', graph],
    ['blob:https://local.invalid/drawio', mxfile],
  ])('renders a local visual preview from %s', async (url, source) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => textResponse(source))
    vi.stubGlobal('fetch', fetchMock)
    render(<DrawioPreview path="diagram.drawio" url={url} size={source.length} compact={url.startsWith('blob:')}/>)

    const svg = await screen.findByRole('img', { name: 'Diagrama Draw.io: diagram.drawio' })
    expect(svg.querySelectorAll('rect, ellipse, polygon').length).toBe(2)
    expect(svg.querySelectorAll('line').length).toBe(1)
    expect(svg.textContent).toContain('Cliente')
    expect(svg.textContent).toContain('API')
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ Range: 'bytes=0-4194303' })
  })

  it('never turns embedded HTML or remote resources into active DOM', async () => {
    const hostile = graph.replace('value="Cliente"', 'value="&lt;img src=&quot;https://evil.invalid/x.png&quot; onerror=&quot;alert(1)&quot;&gt;Cliente"')
    vi.stubGlobal('fetch', vi.fn(async () => textResponse(hostile)))
    const { container } = render(<DrawioPreview path="hostile.drawio" url="blob:https://local.invalid/hostile" size={hostile.length}/>)

    const svg = await screen.findByRole('img', { name: 'Diagrama Draw.io: hostile.drawio' })
    expect(svg.textContent).toContain('Cliente')
    expect(container.querySelector('img, script, iframe, a')).toBe(null)
  })

  it('fails closed for invalid or oversized content', async () => {
    const fetchMock = vi.fn(async () => textResponse('<not-a-drawio/>'))
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = render(<DrawioPreview path="broken.drawio" url="/broken.drawio" size={16}/>)
    expect((await screen.findByText(/mxfile ou mxGraphModel válido/)).textContent).toContain('mxfile')

    rerender(<DrawioPreview path="large.drawio" url="/large.drawio" size={5 * 1024 * 1024}/>)
    expect((await screen.findByText(/excede o limite seguro de 4 MB/)).textContent).toContain('4 MB')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
