import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NoteDocument } from '../types'
import type { AnimationDefinition } from './definitions'
import { parameterNumber } from './definitions'
import { validateAnimationCss } from './css'
import { illuminatedIndices, wordIndices } from './playback'

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; content?: Node[] }

export function AnimationPreview({ document, definition, playing, run, writingMode, onFinish }: {
  document: NoteDocument | null; definition: AnimationDefinition; playing: boolean; run: number; writingMode: boolean; onFinish: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [shadow, setShadow] = useState<ShadowRoot | null>(null)
  const progress = useRef(0)
  const lastLit = useRef<number[]>([])
  useEffect(() => {
    if (host.current && !host.current.shadowRoot) setShadow(host.current.attachShadow({ mode: 'open' }))
  }, [])
  const count = useMemo(() => countWords(document?.doc as Node | undefined), [document])
  const speed = Math.max(1, parameterNumber(definition, definition.playback.kind === 'sequential' ? 'speed' : 'frequency', 3))
  const content = useMemo(() => renderDocumentNodes(document), [document])
  useEffect(() => { progress.current = 0; lastLit.current = [] }, [document])
  useEffect(() => {
    const words = shadow?.querySelectorAll<HTMLElement>('.word')
    if (!words) return
    if (!playing) {
      if (definition.playback.kind === 'random') {
        lastLit.current.forEach(index => { if (words[index]) words[index].dataset.illuminated = 'false' })
        lastLit.current = []
      }
      return
    }
    if (!count) { onFinish(); return }
    const advance = () => {
      if (definition.playback.kind === 'sequential') {
        if (progress.current < words.length) words[progress.current++].dataset.revealed = 'true'
        if (progress.current >= words.length) onFinish()
      } else {
        lastLit.current.forEach(index => { if (words[index]) words[index].dataset.illuminated = 'false' })
        const lit = illuminatedIndices(definition, progress.current++, words.length)
        lit.forEach(index => { words[index].dataset.illuminated = 'true' })
        lastLit.current = lit
      }
    }
    const timer = window.setInterval(advance, 1000 / speed)
    return () => window.clearInterval(timer)
    // The run key remounts this component for replay; stopping retains revealed words.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, shadow, count, speed, definition, run])
  const css = useMemo(() => {
    try { return validateAnimationCss(definition.css) } catch { return '' }
  }, [definition.css])
  const color = String(definition.parameters.find(parameter => parameter.id === 'color')?.value ?? '#ffd166')
  return <div ref={host} className={`animation-preview-host${writingMode ? ' is-writing-preview' : ''}`} aria-label="Animated note preview">
    {shadow && createPortal(<>
      <style>{baseCss}</style>
      <style>{css}</style>
      <div className="animation-paper" style={{ '--animation-color': /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffd166' } as React.CSSProperties}>
        {content}
      </div>
    </>, shadow)}
  </div>
}

function countWords(node: Node | undefined): number {
  if (!node) return 0
  if (node.type === 'text') return wordIndices(node.text ?? '').filter(part => part.index !== null).length
  return (node.content ?? []).reduce((count, child) => count + countWords(child), 0)
}

export function renderDocumentNodes(document: NoteDocument | null): React.ReactNode {
  const node = document?.doc as Node | undefined
  return renderNode(node, { index: 0, count: countWords(node) }, 'root')
}

function renderNode(node: Node | undefined, cursor: { index: number; count: number }, key: string): React.ReactNode {
  if (!node) return null
  if (node.type === 'text') {
    const pieces = wordIndices(node.text ?? '').map((part, local) => {
      if (part.index === null) return part.text
      const index = cursor.index++
      return <span className="word" data-index={index} data-word-count={cursor.count} data-revealed="false" data-illuminated="false" key={`${key}-${local}`}>{part.text}</span>
    })
    return (node.marks ?? []).reduce<React.ReactNode>((result, mark, index) => {
      const tag = mark.type === 'strong' ? 'strong' : mark.type === 'emphasis' ? 'em' : mark.type === 'inlineCode' ? 'code' : mark.type === 'strike_through' ? 's' : mark.type === 'underline' ? 'u' : mark.type === 'highlight' ? 'mark' : 'span'
      const attrs = mark.type === 'textStyle' ? {
        'data-font': safeChoice(mark.attrs?.font, ['sans', 'serif', 'typewriter']),
        'data-size': safeChoice(mark.attrs?.size, ['small', 'large', 'x-large']),
        'data-color': safeChoice(mark.attrs?.color, ['muted', 'amber', 'red', 'blue', 'green']),
      } : {}
      return createElement(tag, { key: `${key}-mark-${index}`, className: `mark-${tag}`, ...attrs }, result)
    }, <>{pieces}</>)
  }
  if (node.type === 'hardbreak') return <br key={key} />
  if (node.type === 'hr') return <hr key={key} />
  if (node.type === 'image') {
    const src = String(node.attrs?.src ?? '')
    const width = String(node.attrs?.width ?? '')
    return /^(https?:|data:image\/(?:png|jpeg|gif|webp|avif);base64,)/i.test(src)
      ? <img key={key} src={src} alt={String(node.attrs?.alt ?? '')} style={/^\d+(?:\.\d+)?(?:px|%)?$/.test(width) ? { width: /^\d+$/.test(width) ? `${width}px` : width } : undefined} /> : null
  }
  const children = (node.content ?? []).map((child, index) => renderNode(child, cursor, `${key}-${index}`))
  if (node.type === 'doc') return <>{children}</>
  const tag = ({ paragraph: 'p', heading: `h${Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))}`, blockquote: 'blockquote', bullet_list: 'ul', ordered_list: 'ol', list_item: 'li', code_block: 'pre', table: 'table', table_row: 'tr', table_cell: 'td', table_header: 'th' } as Record<string, string>)[node.type ?? '']
  if (!tag) return <div key={key}>{children}</div>
  return createElement(tag, { key, className: `animation-block animation-${tag}` }, children)
}

function safeChoice(value: unknown, choices: string[]) { return typeof value === 'string' && choices.includes(value) ? value : undefined }

const baseCss = `
:host { display: block; color: var(--color-input-text); font-family: var(--font-family-ui); }
.animation-paper { box-sizing: border-box; min-height: 100%; padding: var(--card-padding); font-size: var(--notes-editor-font-size); line-height: var(--notes-editor-line-height); overflow-wrap: anywhere; }
:host(.is-writing-preview) .animation-paper { zoom: var(--notes-zoom, 1); width: min(var(--notes-paper-width, 794px), calc((100% - (var(--card-padding) * 2)) / var(--notes-zoom, 1))); min-height: var(--writing-paper-height); margin-inline: auto; padding-block: calc(var(--card-padding) + var(--space-detail-2)) var(--space-writing-bottom); border: var(--border-width-hairline) solid color-mix(in srgb, var(--color-editor-border) 72%, transparent); border-radius: var(--radius-editor); }
:host(.is-writing-preview) .animation-paper > .animation-block { max-width: var(--writing-measure); margin-inline: auto; }
.animation-block { margin: 0 0 var(--space-rich-content-block); }
.animation-paper > .animation-block:first-child { color: var(--color-note-title); font-family: var(--font-family-display); font-size: 1.5em; font-weight: var(--font-weight-note-title); line-height: var(--line-height-tight); }
.animation-h1 { font-size: 1.4em; font-weight: 700; }.animation-h2 { font-size: 1.25em; font-weight: 700; }.animation-h3 { font-size: 1.1em; font-weight: 700; }
.animation-blockquote { padding-left: var(--space-rich-content-inset); border-left: var(--border-width-rich-content) solid var(--color-control-border-hover); }
.animation-ul { list-style: disc; padding-left: 2em; }.animation-ol { list-style: decimal; padding-left: 2em; }
.animation-pre { white-space: pre-wrap; font-family: var(--font-family-code); }
.mark-strong { font-weight: 700; }.mark-em { font-style: italic; }.mark-code { font-family: var(--font-family-code); }.mark-s { text-decoration: line-through; }.mark-u { text-decoration: underline; }.mark-mark { background: var(--color-note-highlight); }
.mark-span[data-font="serif"] { font-family: Georgia, "Times New Roman", serif; }.mark-span[data-font="sans"] { font-family: Arial, sans-serif; }.mark-span[data-font="typewriter"] { font-family: "Courier New", monospace; }
.mark-span[data-size="small"] { font-size: .8em; }.mark-span[data-size="large"] { font-size: 1.25em; }.mark-span[data-size="x-large"] { font-size: 1.6em; }
.mark-span[data-color="muted"] { color: var(--color-text-muted); }.mark-span[data-color="amber"] { color: #d98a00; }.mark-span[data-color="red"] { color: #dc3f35; }.mark-span[data-color="blue"] { color: #2f85dc; }.mark-span[data-color="green"] { color: #2f9e55; }
.animation-paper img { max-width: 100%; }.word { display: inline; }
`
