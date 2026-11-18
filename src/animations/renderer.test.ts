import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderDocumentNodes } from './AnimationPreview'
import type { NoteDocument } from '../types'

const snapshot = (doc: Record<string, unknown>): NoteDocument => ({ schemaVersion: 1, doc })

describe('animation document rendering', () => {
  it('keeps headings, paragraphs, emphasis and line breaks in order without changing its source', () => {
    const document = snapshot({ type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A title' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'Some ' },
        { type: 'text', text: 'strong words', marks: [{ type: 'strong' }] },
        { type: 'hardbreak' },
        { type: 'text', text: 'next line' },
      ] },
    ] })
    const original = JSON.stringify(document)
    const markup = renderToStaticMarkup(renderDocumentNodes(document))
    expect(markup).toContain('<h2')
    expect(markup).toContain('<p')
    expect(markup).toContain('<strong')
    expect(markup).toContain('<br')
    expect([...markup.matchAll(/data-index="(\d+)"/g)].map(match => Number(match[1]))).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(JSON.stringify(document)).toBe(original)
  })

  it('keeps SVG pictures added from a file', () => {
    const src = 'data:image/svg+xml;base64,PHN2Zy8+'
    const markup = renderToStaticMarkup(renderDocumentNodes(snapshot({ type: 'doc', content: [{ type: 'image', attrs: { src, alt: 'logo' } }] })))
    expect(markup).toContain(`src="${src}"`)
  })

  it('renders an empty document and a long document', () => {
    expect(renderToStaticMarkup(renderDocumentNodes(snapshot({ type: 'doc', content: [] })))).toBe('')
    const text = Array(2001).join('word ')
    const markup = renderToStaticMarkup(renderDocumentNodes(snapshot({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })))
    expect([...markup.matchAll(/data-index=/g)]).toHaveLength(2000)
  })
})
