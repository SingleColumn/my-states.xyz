import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { WordGraphWindow } from './WordGraphWindow'
import { loadSavedWordGraph, markSavedWordGraphClosed, saveCompletedWordGraph, updateSavedWordGraphPresentation, type SavedWordGraph } from './wordGraphStorage'
import type { WordGraph } from './wordGraphTypes'

export interface WordGraphRequest {
  word: string
  context: string
  anchor: { x: number; y: number }
  returnFocus: HTMLElement
  restoredGraph?: WordGraph
  restoredPresentation?: SavedWordGraph['presentation']
}
const OpenContext = createContext<(request: WordGraphRequest) => void>(() => {})
export const useOpenWordGraph = () => useContext(OpenContext)

function ignoreStorageFailure(operation: Promise<unknown>) {
  void operation.catch(error => console.warn('Word Graph recovery storage is unavailable.', error))
}

/** Scoped to the mounted canvas and cleared on board changes: nothing enters board state. */
export function WordGraphProvider({ boardId, children }: { boardId: string; children: ReactNode }) {
  const activeBoardId = useRef(boardId)
  activeBoardId.current = boardId
  const [request, setRequest] = useState<(WordGraphRequest & { boardId: string }) | null>(null)
  const [generation, setGeneration] = useState(0)
  const [restored, setRestored] = useState<(WordGraphRequest & { boardId: string }) | null>(null)
  useEffect(() => {
    let active = true
    setRequest(null)
    setRestored(null)
    void loadSavedWordGraph(boardId)
      .then(record => {
        if (active && record?.presentation.isOpen) setRestored({ word: record.graph.rootWord, context: '', anchor: { x: 120, y: 80 }, returnFocus: document.body, restoredGraph: record.graph, restoredPresentation: record.presentation, boardId })
      })
      .catch(error => { if (active) console.warn('Word Graph recovery storage is unavailable.', error) })
    return () => { active = false }
  }, [boardId])
  const open = useCallback((next: WordGraphRequest) => { setRestored(null); setRequest({ ...next, boardId }); setGeneration(value => value + 1) }, [boardId])
  const graphReady = useCallback((graph: WordGraph, presentation: Partial<SavedWordGraph['presentation']>) => {
    if (activeBoardId.current !== boardId) return
    ignoreStorageFailure(saveCompletedWordGraph(boardId, graph, presentation))
  }, [boardId])
  const presentationChanged = useCallback((presentation: Partial<SavedWordGraph['presentation']>) => {
    if (activeBoardId.current !== boardId) return
    ignoreStorageFailure(updateSavedWordGraphPresentation(boardId, presentation))
  }, [boardId])
  const close = useCallback(() => {
    setRequest(null)
    setRestored(null)
    ignoreStorageFailure(markSavedWordGraphClosed(boardId))
    if (request?.returnFocus.isConnected) request.returnFocus.focus({ preventScroll: true })
  }, [boardId, request])
  return <OpenContext.Provider value={open}>
    {children}
    {request && request.boardId === boardId ? <WordGraphWindow key={generation} request={request} onGraphReady={graphReady} onPresentationChange={presentationChanged} onClose={close} /> : restored && restored.boardId === boardId ? <WordGraphWindow key={`restored-${restored.restoredGraph?.rootId}`} request={restored} onGraphReady={graphReady} onPresentationChange={presentationChanged} onClose={close} /> : null}
  </OpenContext.Provider>
}
