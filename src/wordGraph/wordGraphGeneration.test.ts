import { describe, expect, it, vi } from 'vitest'
import { generateWordGraph, type WordGraphGenerationRequest } from './wordGraphGeneration'
import { relationshipTypes, type RelationshipType, type WordGraph } from './wordGraphTypes'
import { validateWordGraphStructure } from './wordGraphValidation'

type Candidate = { word: string; relationship: RelationshipType }
const baseRequest: WordGraphGenerationRequest = {
  word: 'root',
  context: 'test context',
  depth: 2,
  maxConnectionsPerNode: 4,
  maxTotalNodes: 30,
  maxRemoteness: 0.65,
  relationshipTypes,
}

function fixture(responses: Record<string, Candidate[]>, rejectedWords: string[] = []) {
  const rejected = new Set(rejectedWords)
  const calls: string[] = []
  const associations = vi.fn(async ({ word }: { word: string }) => {
    calls.push(word)
    return { candidates: responses[word] ?? [] }
  })
  const embeddings = vi.fn(async ({ input }: { input: string[] }) => ({
    embeddings: input.map(word => rejected.has(word) ? [-1, 0] : [1, 0]),
  }))
  return { associations, embeddings, calls }
}

function numbered(prefix: string, count: number): Candidate[] {
  return Array.from({ length: count }, (_, index) => ({ word: `${prefix}-${index + 1}`, relationship: 'semantic' }))
}

function expectValid(graph: WordGraph, request: WordGraphGenerationRequest) {
  const validation = validateWordGraphStructure(graph, request)
  expect(validation.errors).toEqual([])
  expect(validation.valid).toBe(true)
}

describe('Word Graph generation constraints', () => {
  it('counts the root in the total-node budget and stops before orphaning excess candidates', async () => {
    const responses: Record<string, Candidate[]> = { root: numbered('level-1', 12) }
    for (let index = 1; index <= 12; index++) responses[`level-1-${index}`] = numbered(`level-2-${index}`, 12)
    const mocks = fixture(responses)
    const graph = await generateWordGraph(baseRequest, mocks.associations, mocks.embeddings)

    expect(graph.nodes.length).toBeLessThanOrEqual(30)
    expect(graph.nodes).toHaveLength(21)
    expect(graph.nodes.filter(node => node.id === graph.rootId)).toHaveLength(1)
    expectValid(graph, baseRequest)
  })

  it('returns only the root for a node limit of one without making avoidable requests', async () => {
    const mocks = fixture({ root: numbered('candidate', 10) })
    const request = { ...baseRequest, maxTotalNodes: 1 }
    const graph = await generateWordGraph(request, mocks.associations, mocks.embeddings)

    expect(graph.nodes.map(node => node.normalizedWord)).toEqual(['root'])
    expect(graph.edges).toEqual([])
    expect(mocks.associations).not.toHaveBeenCalled()
    expect(mocks.embeddings).not.toHaveBeenCalled()
    expectValid(graph, request)
  })

  it('honors a node limit below the first response size and deduplicates near exhaustion', async () => {
    const mocks = fixture({ root: [
      { word: 'Alpha', relationship: 'semantic' },
      { word: 'ALPHA', relationship: 'semantic' },
      { word: 'beta', relationship: 'conceptual' },
      { word: 'beta', relationship: 'conceptual' },
      { word: 'gamma', relationship: 'emotional' },
    ] })
    const request = { ...baseRequest, depth: 1, maxTotalNodes: 3, maxConnectionsPerNode: 10 }
    const graph = await generateWordGraph(request, mocks.associations, mocks.embeddings)

    expect(graph.nodes.map(node => node.normalizedWord)).toEqual(['root', 'alpha', 'beta'])
    expect(graph.edges).toHaveLength(2)
    expect(graph.nodes.some(node => node.normalizedWord === 'gamma')).toBe(false)
    expectValid(graph, request)
  })

  it('does not expand maximum-depth nodes and calculates cross-link depth from the visual topology', async () => {
    const mocks = fixture({
      root: [{ word: 'a', relationship: 'semantic' }, { word: 'b', relationship: 'semantic' }],
      a: [{ word: 'c', relationship: 'conceptual' }],
      b: [{ word: 'c', relationship: 'emotional' }],
      c: [{ word: 'depth-3', relationship: 'semantic' }],
      'depth-3': [{ word: 'depth-4', relationship: 'semantic' }],
    })
    const graph = await generateWordGraph(baseRequest, mocks.associations, mocks.embeddings)

    expect(Math.max(...graph.nodes.map(node => node.depth))).toBe(2)
    expect(graph.nodes.some(node => node.normalizedWord === 'depth-3')).toBe(false)
    expect(mocks.calls).toEqual(['root', 'a', 'b'])
    expect(graph.nodes.find(node => node.normalizedWord === 'c')?.depth).toBe(2)
    expectValid(graph, baseRequest)
  })

  it('limits outgoing accepted relationships per source without charging duplicates or rejections', async () => {
    const mocks = fixture({ root: [
      { word: 'remote', relationship: 'semantic' },
      { word: 'a', relationship: 'semantic' },
      { word: 'A', relationship: 'semantic' },
      { word: 'b', relationship: 'conceptual' },
      { word: 'c', relationship: 'emotional' },
      { word: 'd', relationship: 'symbolic' },
      { word: 'e', relationship: 'sensory' },
    ] }, ['remote'])
    const request = { ...baseRequest, depth: 1 }
    const graph = await generateWordGraph(request, mocks.associations, mocks.embeddings)

    expect(graph.edges).toHaveLength(4)
    expect(graph.edges.every(edge => edge.source === graph.rootId)).toBe(true)
    expect(graph.nodes.some(node => node.normalizedWord === 'remote')).toBe(false)
    expect(graph.nodes.some(node => node.normalizedWord === 'e')).toBe(false)
    expectValid(graph, request)
  })

  it('applies the same outgoing budget to relationships targeting existing nodes', async () => {
    const mocks = fixture({
      root: [{ word: 'a', relationship: 'semantic' }, { word: 'b', relationship: 'semantic' }],
      a: [
        { word: 'b', relationship: 'conceptual' },
        { word: 'b', relationship: 'conceptual' },
        { word: 'root', relationship: 'opposite' },
        { word: 'c', relationship: 'emotional' },
        { word: 'd', relationship: 'symbolic' },
        { word: 'e', relationship: 'sensory' },
      ],
    })
    const request = { ...baseRequest, maxConnectionsPerNode: 4 }
    const graph = await generateWordGraph(request, mocks.associations, mocks.embeddings)
    const fromA = graph.edges.filter(edge => edge.source === 'word:a')

    expect(fromA).toHaveLength(4)
    expect(fromA.filter(edge => edge.target === 'word:b')).toHaveLength(1)
    expect(graph.nodes.some(node => node.normalizedWord === 'e')).toBe(false)
    expectValid(graph, request)
  })

  it('never schedules or materializes a node whose connecting edge is rejected', async () => {
    const mocks = fixture({
      root: [{ word: 'rejected-parent', relationship: 'semantic' }, { word: 'kept', relationship: 'semantic' }],
      'rejected-parent': [{ word: 'orphan', relationship: 'semantic' }],
      kept: [{ word: 'root', relationship: 'opposite' }, { word: 'rejected-link', relationship: 'conceptual' }],
    }, ['rejected-parent', 'rejected-link'])
    const graph = await generateWordGraph(baseRequest, mocks.associations, mocks.embeddings)

    expect(mocks.calls).toEqual(['root', 'kept'])
    expect(graph.nodes.map(node => node.normalizedWord)).toEqual(['root', 'kept'])
    expect(graph.nodes.some(node => node.normalizedWord === 'orphan')).toBe(false)
    expectValid(graph, baseRequest)
  })

  it('remains within all budgets with delayed asynchronous responses', async () => {
    const responses: Record<string, Candidate[]> = { root: numbered('child', 8) }
    for (let index = 1; index <= 8; index++) responses[`child-${index}`] = numbered(`leaf-${index}`, 8)
    const completions: string[] = []
    const associations = vi.fn(async ({ word }: { word: string }) => {
      await new Promise(resolve => setTimeout(resolve, word === 'root' ? 5 : 8 - Number(word.split('-')[1] ?? 0)))
      completions.push(word)
      return { candidates: responses[word] ?? [] }
    })
    const embeddings = vi.fn(async ({ input }: { input: string[] }) => ({ embeddings: input.map(() => [1, 0]) }))
    const request = { ...baseRequest, maxTotalNodes: 12 }
    const graph = await generateWordGraph(request, associations, embeddings)

    expect(graph.nodes.length).toBeLessThanOrEqual(12)
    expect(completions.indexOf('child-4')).toBeLessThan(completions.indexOf('child-1'))
    expect(graph.nodes.slice(1, 5).map(node => node.normalizedWord)).toEqual(['child-1', 'child-2', 'child-3', 'child-4'])
    expectValid(graph, request)
  })

  it('does not admit a response that completes after cancellation', async () => {
    let release!: (value: { candidates: Candidate[] }) => void
    const pending = new Promise<{ candidates: Candidate[] }>(resolve => { release = resolve })
    const associations = vi.fn(() => pending)
    const embeddings = vi.fn(async ({ input }: { input: string[] }) => ({ embeddings: input.map(() => [1, 0]) }))
    const controller = new AbortController()
    const generation = generateWordGraph(baseRequest, associations, embeddings, controller.signal)
    controller.abort()
    release({ candidates: [{ word: 'late', relationship: 'semantic' }] })

    await expect(generation).rejects.toMatchObject({ name: 'AbortError' })
    expect(embeddings).not.toHaveBeenCalled()
  })

  it('keeps the deterministic Love regression fixture structurally compliant', async () => {
    const responses: Record<string, Candidate[]> = {
      love: [
        { word: 'hate', relationship: 'opposite' }, { word: 'compassion', relationship: 'emotional' },
        { word: 'duality', relationship: 'conceptual' }, { word: 'darkness', relationship: 'symbolic' },
        { word: 'trust', relationship: 'emotional' }, { word: 'devotion', relationship: 'semantic' },
        { word: 'desire', relationship: 'sensory' }, { word: 'conflict', relationship: 'conceptual' },
        { word: 'creation', relationship: 'symbolic' },
      ],
    }
    for (const source of ['hate', 'compassion', 'duality', 'darkness']) {
      responses[source] = numbered(`${source}-association`, 9)
    }
    const mocks = fixture(responses)
    const request = {
      ...baseRequest,
      word: 'Love',
      context: 'Contradictions Love and hate can happen at the same time.',
    }
    const graph = await generateWordGraph(request, mocks.associations, mocks.embeddings)
    const outgoing = new Map<string, number>()
    graph.edges.forEach(edge => outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1))

    expect(graph.nodes).toHaveLength(21)
    expect(Math.max(...graph.nodes.map(node => node.depth))).toBeLessThanOrEqual(2)
    expect(Math.max(...outgoing.values())).toBeLessThanOrEqual(4)
    expect(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.source) && graph.nodes.some(node => node.id === edge.target))).toBe(true)
    expectValid(graph, request)
  })
})

describe('Word Graph structural validation', () => {
  it('reports malformed endpoints, duplicate identities, disconnection, depth and outgoing-limit failures', () => {
    const graph: WordGraph = {
      rootId: 'word:root',
      nodes: [
        { id: 'word:root', label: 'root', normalizedWord: 'root', depth: 0 },
        { id: 'word:a', label: 'a', normalizedWord: 'a', depth: 3 },
        { id: 'word:orphan', label: 'orphan', normalizedWord: 'orphan', depth: Infinity },
      ],
      edges: [
        { id: 'edge-1', source: 'word:root', target: 'word:a', relationship: 'semantic' },
        { id: 'edge-2', source: 'word:root', target: 'word:a', relationship: 'semantic' },
        { id: 'edge-3', source: 'word:root', target: 'word:missing', relationship: 'conceptual' },
      ],
    }
    const result = validateWordGraphStructure(graph, { maxTotalNodes: 2, depth: 0, maxConnectionsPerNode: 1 })

    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/Node count|Duplicate edge|missing target|outgoing connections|disconnected|shortest-path depth|stores depth/)
  })
})
