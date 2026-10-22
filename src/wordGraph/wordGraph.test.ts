import { describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/prose/model'
import { AllSelection, EditorState, TextSelection } from '@milkdown/prose/state'
import { captureWordSelection, normalizeWord, selectedWord } from './wordGraphSelection'
import { buildGraph, createWordGraphFixture } from './wordGraphFixture'
import { visibleGraph } from './wordGraphVisibility'
import { relationshipTypes } from './wordGraphTypes'
const all = new Set(relationshipTypes)
const ids = (...words: string[]) => new Set(words.map(word => `word:${word}`))
const labels = (result: ReturnType<typeof visibleGraph>) => result.nodes.map(node => node.label)

describe('word selection', () => {
  it('normalizes case and canonical Unicode while preserving accents', () => {
    expect(normalizeWord('CAF\u0045\u0301')).toBe('caf\u00e9')
    expect(normalizeWord('\u6771\u4eac')).toBe('\u6771\u4eac')
  })
  it('trims boundary punctuation and whitespace and keeps internal apostrophes and hyphens', () => {
    expect(selectedWord(' \u201c\u00c9t\u00e9!\u201d ')).toBe('\u00c9t\u00e9')
    expect(selectedWord("writer's")).toBe("writer's")
    expect(selectedWord('l\u2019ombre')).toBe('l\u2019ombre')
    expect(selectedWord('well-known')).toBe('well-known')
  })
  it('rejects empty, multiple words, symbols, digits and internal punctuation', () => {
    for (const text of ['', '...', '  ', 'two words', 'one\ntwo', 'one,two', '12', 'a+b', 'a?b', '\ud83c\udf19']) expect(selectedWord(text)).toBeNull()
  })
  it('accepts a whole one-word note but rejects a whole multi-block document', () => {
    const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } })
    const paragraph = schema.node('paragraph', null, schema.text('dark'))
    const doc = schema.node('doc', null, [paragraph])
    expect(captureWordSelection(EditorState.create({ doc, selection: new AllSelection(doc) }))?.word).toBe('dark')
    const multi = schema.node('doc', null, [paragraph, paragraph])
    expect(captureWordSelection(EditorState.create({ doc: multi, selection: new AllSelection(multi) }))).toBeNull()
  })
  it('captures bounded context from a real text selection without changing its document', () => {
    const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } })
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('A dark night')), schema.node('paragraph', null, schema.text('Another line'))])
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3, 7) })
    expect(captureWordSelection(state)).toEqual({ word: 'dark', context: 'A dark night Another line' })
    expect(state.doc).toBe(doc)
    expect(captureWordSelection(EditorState.create({ doc }))).toBeNull()
    expect(captureWordSelection(EditorState.create({ doc, selection: TextSelection.create(doc, 3, 19) }))).toBeNull()
  })
})

describe('graph data and reachability', () => {
  const graph = createWordGraphFixture('dark')
  it('deduplicates normalized words and edges while retaining multiple relationship types', () => {
    const graph = buildGraph('ROOT', [['ROOT', 'Caf\u00e9', 'related'], ['ROOT', 'CAFE\u0301', 'feeling'], ['ROOT', 'Caf\u00e9', 'related']])
    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toHaveLength(2)
    expect(graph.nodes[1].depth).toBe(1)
  })
  it('opens the fixture at its root and first level, then expands and collapses', () => {
    expect(labels(visibleGraph(graph, ids('dark'), all))).toEqual(['dark', 'night', 'fear', 'mystery', 'shadow', 'unknown', 'light'])
    expect(labels(visibleGraph(graph, ids('dark', 'night'), all))).toContain('dreams')
    expect(labels(visibleGraph(graph, ids('dark'), all))).not.toContain('dreams')
  })
  it('filters relationships through connectivity and restores preserved expansion', () => {
    const expanded = ids('dark', 'night')
    const enabled = new Set(relationshipTypes.filter(type => type !== 'related'))
    expect(labels(visibleGraph(graph, expanded, enabled))).not.toContain('night')
    expect(labels(visibleGraph(graph, expanded, enabled))).not.toContain('dreams')
    expect(labels(visibleGraph(graph, expanded, all))).toContain('dreams')
    expect(expanded.has('word:night')).toBe(true)
  })
  it('keeps shared nodes reachable through another expanded and enabled path', () => {
    const graph = buildGraph('root', [['root', 'a', 'related'], ['root', 'b', 'feeling'], ['a', 'shared', 'related'], ['b', 'shared', 'feeling'], ['shared', 'leaf', 'sensory']])
    const result = visibleGraph(graph, ids('root', 'b', 'shared'), all)
    expect(labels(result)).toContain('shared')
    expect(labels(result)).toContain('leaf')
    expect(result.edges.some(edge => edge.source === 'word:a')).toBe(false)
    expect(labels(visibleGraph(graph, ids('root', 'b', 'shared'), new Set(['related'])))).not.toContain('shared')
  })
  it('terminates on cycles and traverses each reachable node once', () => {
    const graph = buildGraph('a', [['a', 'b', 'related'], ['b', 'c', 'related'], ['c', 'a', 'opposite']])
    expect(visibleGraph(graph, ids('a', 'b', 'c'), all).nodes).toHaveLength(3)
    expect(visibleGraph(graph, ids('a', 'b', 'c'), all).edges).toHaveLength(3)
    expect(graph.nodes.map(node => node.depth)).toEqual([0, 1, 1])
  })
  it('always keeps the root, including when all filters or the root are collapsed', () => {
    expect(labels(visibleGraph(graph, ids('dark'), new Set()))).toEqual(['dark'])
    expect(labels(visibleGraph(graph, new Set(), all))).toEqual(['dark'])
  })
  it('uses arbitrary selected words as sample roots and deduplicates fixture collisions', () => {
    const graph = createWordGraphFixture('night')
    expect(graph.nodes.find(node => node.id === graph.rootId)?.label).toBe('night')
    expect(new Set(graph.nodes.map(node => node.normalizedWord)).size).toBe(graph.nodes.length)
  })
})
