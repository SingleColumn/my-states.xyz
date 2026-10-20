import { afterEach, describe, expect, it } from 'vitest'
import { createWordGraphFixture } from './wordGraphFixture'
import { deleteSavedWordGraph, loadSavedWordGraph, markSavedWordGraphClosed, saveCompletedWordGraph, updateSavedWordGraphPresentation, type SavedWordGraph } from './wordGraphStorage'

const boardIds = new Set<string>()
function boardId(label: string) {
  const id = `word-graph-storage-test:${label}:${crypto.randomUUID()}`
  boardIds.add(id)
  return id
}

afterEach(async () => {
  await Promise.all([...boardIds].map(id => deleteSavedWordGraph(id)))
  boardIds.clear()
})

describe('Word Graph recovery storage', () => {
  it('saves and restores graph data and the complete presentation', async () => {
    const id = boardId('complete')
    const graph = createWordGraphFixture('dark')
    const presentation: SavedWordGraph['presentation'] = {
      expandedNodeIds: ['word:dark', 'word:night'],
      enabledRelationshipTypes: ['semantic', 'opposite'],
      nodePositions: { 'word:night': { x: 41, y: -23 } },
      viewport: { x: 17, y: -9, zoom: 1.6 },
      window: { x: 180, y: 120, width: 760, height: 540, maximized: true },
      isOpen: true,
    }

    await saveCompletedWordGraph(id, graph, presentation)
    const saved = await loadSavedWordGraph(id)

    expect(saved?.graph).toEqual({ rootId: graph.rootId, rootWord: 'dark', nodes: graph.nodes, edges: graph.edges })
    expect(saved?.presentation).toEqual(presentation)
  })

  it('serializes partial presentation writes so rapid interactions do not lose state', async () => {
    const id = boardId('updates')
    const graph = createWordGraphFixture('dark')
    await saveCompletedWordGraph(id, graph)

    await Promise.all([
      updateSavedWordGraphPresentation(id, { nodePositions: { 'word:night': { x: 80, y: 45 } } }),
      updateSavedWordGraphPresentation(id, { viewport: { x: -25, y: 18, zoom: 1.3 } }),
      updateSavedWordGraphPresentation(id, { expandedNodeIds: ['word:dark', 'word:night'] }),
      updateSavedWordGraphPresentation(id, { enabledRelationshipTypes: ['semantic', 'sensory'] }),
      updateSavedWordGraphPresentation(id, { window: { x: 90, y: 75, width: 680, height: 460, maximized: false } }),
    ])

    expect((await loadSavedWordGraph(id))?.presentation).toMatchObject({
      nodePositions: { 'word:night': { x: 80, y: 45 } },
      viewport: { x: -25, y: 18, zoom: 1.3 },
      expandedNodeIds: ['word:dark', 'word:night'],
      enabledRelationshipTypes: ['semantic', 'sensory'],
      window: { x: 90, y: 75, width: 680, height: 460, maximized: false },
    })
  })

  it('records intentional closure without deleting the recoverable graph', async () => {
    const id = boardId('closed')
    const graph = createWordGraphFixture('dark')
    await saveCompletedWordGraph(id, graph)
    await markSavedWordGraphClosed(id)

    const saved = await loadSavedWordGraph(id)
    expect(saved?.presentation.isOpen).toBe(false)
    expect(saved?.graph.nodes).toEqual(graph.nodes)
  })
})
