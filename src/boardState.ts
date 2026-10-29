import { useCallback, useEffect, useRef, useState } from 'react'
import { type TLStoreSnapshot } from 'tldraw'
import type { CanvasCamera, Board, BoardSummary } from './types'
import {
  createBoard as createStoredBoard,
  deleteBoard as deleteStoredBoard,
  getBoard,
  getBoardSummaries,
  initializeBoards,
  renameBoard,
  saveBoardDocument,
  setBoardTheme,
  subscribeStorageStatus,
  setActiveBoardId,
} from './storage'
import { SaveQueue } from './saveQueue'
import { createSaveStatusStore } from './saveStatus'
import { deleteSavedWordGraph } from './wordGraph/wordGraphStorage'
import { BoardOperation } from './boardOperation'

/** The open board and the board list: loading, saving the canvas, and the operations that change which board is open. */
export function useBoardState() {
  const [boards, setBoards] = useState<BoardSummary[]>([])
  const [activeBoard, setActiveBoard] = useState<Board | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeBoardRef = useRef<Board | null>(null)
  const [saveStatus] = useState(createSaveStatusStore)
  const [saveQueue] = useState(() => new SaveQueue(
    (caught) => {
      saveStatus.markFailed()
      setError(caught instanceof Error ? caught.message : 'Could not save the board. Keep this tab open and try again.')
    },
    (busy) => saveStatus.markBusy(busy),
  ))
  const [operation] = useState(() => new BoardOperation())
  const canvasFlushRef = useRef<(() => void | Promise<void>) | null>(null)
  const canvasRestoreRef = useRef<((board: Board) => (() => void)) | null>(null)

  const refreshSummaries = useCallback(async () => {
    setBoards(await getBoardSummaries())
  }, [])

  useEffect(() => subscribeStorageStatus((status) => { if (status) setError(status) }), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const initial = await initializeBoards()
        let summaries = await getBoardSummaries()
        if (cancelled) return
        let board = await getBoard(initial.activeBoardId).catch(() => undefined)
        let openError: string | null = null
        // Listing is metadata-only and does not hit this, but opening the
        // remembered active board can still fail (schema mismatch, for
        // instance). Fall back to another board rather than stranding the
        // user on the loading screen with nothing to open; the unreadable
        // record is left untouched and stays listed for a build that can
        // read it.
        if (!board) {
          openError = 'Your last-opened board could not be read. Its stored data has not been changed.'
          for (const candidate of summaries) {
            if (candidate.id === initial.activeBoardId) continue
            board = await getBoard(candidate.id).catch(() => undefined)
            if (cancelled) return
            if (board) {
              await setActiveBoardId(candidate.id)
              break
            }
          }
        }
        if (!board) {
          // Every stored board failed to open, not only the active one (for
          // example, a schema version bump made all of them unreadable at
          // once): fall back exactly as if there were none, rather than
          // leaving nothing to open and no way to start one. Their records
          // are left untouched and stay listed.
          board = await createStoredBoard('A new board')
          if (cancelled) return
          summaries = await getBoardSummaries()
          await setActiveBoardId(board.id)
          openError = summaries.length > 1 ? 'None of your saved boards could be opened by this version. A new one has been started; their stored data has not been changed.' : null
        }
        if (cancelled) return
        setBoards(summaries)
        activeBoardRef.current = board
        setActiveBoard(board)
        setError(openError)
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load your boards.')
      } finally {
        if (!cancelled) setIsReady(true)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const registerCanvasFlush = useCallback((flush: () => void | Promise<void>) => {
    canvasFlushRef.current = flush
    return () => {
      if (canvasFlushRef.current === flush) canvasFlushRef.current = null
    }
  }, [])

  const registerCanvasRestore = useCallback((prepare: (board: Board) => (() => void)) => {
    canvasRestoreRef.current = prepare
    return () => { if (canvasRestoreRef.current === prepare) canvasRestoreRef.current = null }
  }, [])

  const flush = useCallback(async () => {
    // Invoke synchronously so visibility/pagehide captures changes even if
    // tldraw has not delivered its animation-frame listener yet.
    const canvasFlush = canvasFlushRef.current?.()
    await canvasFlush
    await saveQueue.flush()
  }, [saveQueue])

  const loadBoard = useCallback(async (boardId: string, flushCurrent = true) => {
    const board = await getBoard(boardId)
    if (!board) throw new Error('The requested board no longer exists.')
    const restore = canvasRestoreRef.current?.(board)
    // Input is paused by the enclosing board operation. Take one final
    // snapshot before committing the active preference and ref handoff.
    if (flushCurrent) await flush()
    await setActiveBoardId(boardId)
    activeBoardRef.current = board
    // Finish the editor handoff while the operation still owns the input
    // pause, not in a later React effect after input has been released.
    restore?.()
    setActiveBoard(board)
    setError(null)
  }, [flush])

  const open = useCallback(async (boardId: string) => {
    await flush()
    await loadBoard(boardId)
  }, [flush, loadBoard])

  const create = useCallback(async (name: string) => {
    const board = await createStoredBoard(name)
    await refreshSummaries()
    await open(board.id)
  }, [open, refreshSummaries])

  const rename = useCallback(async (name: string) => {
    const current = activeBoardRef.current
    if (!current) return
    saveQueue.enqueue(`name:${current.id}`, async () => {
      const saved = await renameBoard(current.id, name)
      if (activeBoardRef.current?.id === saved.id) {
        activeBoardRef.current = { ...activeBoardRef.current, name: saved.name, updatedAt: saved.updatedAt }
        setActiveBoard((active) => active?.id === saved.id ? { ...active, name: saved.name, updatedAt: saved.updatedAt } : active)
      }
    })
    await saveQueue.flush()
    await refreshSummaries()
  }, [refreshSummaries, saveQueue])

  const setTheme = useCallback(async (themeId: string | null) => {
    const current = activeBoardRef.current
    if (!current) return
    saveQueue.enqueue(`theme:${current.id}`, async () => {
      const saved = await setBoardTheme(current.id, themeId)
      if (activeBoardRef.current?.id !== saved.id) return
      const { themeId: _previous, ...rest } = activeBoardRef.current
      activeBoardRef.current = { ...rest, ...(saved.themeId ? { themeId: saved.themeId } : {}), updatedAt: saved.updatedAt }
      setActiveBoard((active) => {
        if (active?.id !== saved.id) return active
        const { themeId: _stale, ...kept } = active
        return { ...kept, ...(saved.themeId ? { themeId: saved.themeId } : {}), updatedAt: saved.updatedAt }
      })
    })
    await saveQueue.flush()
    await refreshSummaries()
  }, [refreshSummaries, saveQueue])

  const remove = useCallback(async (boardId: string) => {
    const removingActive = activeBoardRef.current?.id === boardId
    await deleteStoredBoard(boardId)
    // A board's Word Graph is kept in its own database, so it is not removed with the board unless asked.
    // Failing to remove it must not leave the board half-deleted.
    await deleteSavedWordGraph(boardId).catch(() => undefined)
    if (removingActive) activeBoardRef.current = null
    const remaining = await getBoardSummaries()
    setBoards(remaining)
    if (!removingActive) return

    if (remaining[0]) {
      await loadBoard(remaining[0].id, false)
      return
    }

    const replacement = await createStoredBoard('A new board')
    setBoards(await getBoardSummaries())
    await loadBoard(replacement.id, false)
  }, [loadBoard])

  // The document changes on every drag and every edit, so it is kept on the
  // ref and in the database and not in React state: nothing renders from it,
  // and a state update here would re-render every panel on each change.
  const updateDocument = useCallback((boardId: string, document: TLStoreSnapshot, camera: CanvasCamera) => {
    // A delayed listener from the outgoing canvas must not save into the
    // destination, or resurrect a board the user has just removed.
    if (activeBoardRef.current?.id !== boardId) return
    saveQueue.enqueue(`document:${boardId}`, async () => {
      const saved = await saveBoardDocument(boardId, document, camera)
      // This ref describes committed storage, not an optimistic snapshot.
      // The queue retains unsaved snapshots independently for retry.
      if (activeBoardRef.current?.id === saved.id) activeBoardRef.current = saved
      setError(null)
    })
  }, [saveQueue])

  return {
    isReady,
    operation,
    boards,
    activeBoard,
    error,
    saveStatus,
    create,
    open,
    rename,
    setTheme,
    remove,
    refreshSummaries,
    updateDocument,
    getActiveBoardRecord: () => activeBoardRef.current,
    registerCanvasFlush,
    registerCanvasRestore,
    flush,
  }
}
