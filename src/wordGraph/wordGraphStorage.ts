import { openDB } from 'idb'
import type { RelationshipType, WordGraph, WordGraphNode, WordGraphEdge } from './wordGraphTypes'

export interface SavedWordGraph {
  schemaVersion: 1
  boardId: string
  graphId: string
  createdAt: string
  updatedAt: string
  graph: { rootId: string; rootWord: string; nodes: WordGraphNode[]; edges: WordGraphEdge[] }
  presentation: { expandedNodeIds: string[]; enabledRelationshipTypes: RelationshipType[]; nodePositions?: Record<string, { x: number; y: number }>; viewport?: { x: number; y: number; zoom: number }; window?: { x: number; y: number; width: number; height: number; maximized: boolean }; isOpen: boolean }
}
interface GraphDb { graphs: { key: string; value: SavedWordGraph } }
const db = openDB<GraphDb>('my-states-word-graphs', 1, { upgrade(database) { database.createObjectStore('graphs') } })
const writes = new Map<string, Promise<void>>()

function valid(value: unknown): value is SavedWordGraph { const item = value as SavedWordGraph; return Boolean(item && item.schemaVersion === 1 && item.boardId && item.graphId && item.graph?.rootId && Array.isArray(item.graph.nodes) && Array.isArray(item.graph.edges) && item.presentation && Array.isArray(item.presentation.expandedNodeIds) && Array.isArray(item.presentation.enabledRelationshipTypes)) }
async function readSavedWordGraph(boardId: string) { const item = await (await db).get('graphs', boardId); return valid(item) ? item : null }
async function afterPendingWrites(boardId: string) { await writes.get(boardId) }
function enqueueWrite<T>(boardId: string, operation: () => Promise<T>): Promise<T> {
  const previous = writes.get(boardId) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  const tracked = result.then(() => undefined, () => undefined)
  writes.set(boardId, tracked)
  void tracked.finally(() => { if (writes.get(boardId) === tracked) writes.delete(boardId) })
  return result
}

export async function loadSavedWordGraph(boardId: string) { await afterPendingWrites(boardId); return readSavedWordGraph(boardId) }
export function saveCompletedWordGraph(boardId: string, graph: WordGraph, presentation: Partial<SavedWordGraph['presentation']> = {}) {
  return enqueueWrite(boardId, async () => {
    const now = new Date().toISOString()
    const previous = await readSavedWordGraph(boardId)
    const item: SavedWordGraph = {
      schemaVersion: 1,
      boardId,
      graphId: previous?.graphId ?? crypto.randomUUID(),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      graph: { rootId: graph.rootId, rootWord: graph.nodes.find(node => node.id === graph.rootId)?.label ?? graph.rootId, nodes: graph.nodes, edges: graph.edges },
      presentation: {
        ...presentation,
        expandedNodeIds: presentation.expandedNodeIds ?? [graph.rootId],
        enabledRelationshipTypes: presentation.enabledRelationshipTypes ?? ['semantic', 'conceptual', 'emotional', 'symbolic', 'sensory', 'opposite'],
        isOpen: presentation.isOpen ?? true,
      },
    }
    await (await db).put('graphs', item, boardId)
    return item
  })
}
export function updateSavedWordGraphPresentation(boardId: string, presentation: Partial<SavedWordGraph['presentation']>) {
  return enqueueWrite(boardId, async () => {
    const item = await readSavedWordGraph(boardId)
    if (!item) return
    item.updatedAt = new Date().toISOString()
    item.presentation = { ...item.presentation, ...presentation }
    await (await db).put('graphs', item, boardId)
  })
}
export async function markSavedWordGraphClosed(boardId: string) { await updateSavedWordGraphPresentation(boardId, { isOpen: false }) }
export function deleteSavedWordGraph(boardId: string) { return enqueueWrite(boardId, async () => { await (await db).delete('graphs', boardId) }) }
