import './test/setup'
import { describe, expect, it, vi } from 'vitest'
import type { Editor, TLShape } from 'tldraw'
import { createCanvasApi } from './canvasApi'
import type { AppStateValue } from './AppState'
import { createPanelProps } from './panelStore'
import type { PanelType } from './types'

function makeShape(type: PanelType, panelId: string): TLShape {
  const props = createPanelProps(type, panelId)
  return {
    id: `shape:${panelId}`,
    type: 'music-panel',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a1',
    parentId: 'page:page',
    isLocked: false,
    opacity: 1,
    props,
    meta: {},
    typeName: 'shape',
  } as unknown as TLShape
}

function editorWith(...shapes: TLShape[]): Editor {
  return { getCurrentPageShapesSorted: () => shapes } as unknown as Editor
}

function fakeState(overrides: Partial<{ deleteNote: ReturnType<typeof vi.fn>; isOperationPending: boolean }> = {}) {
  const deleteNote = overrides.deleteNote ?? vi.fn().mockResolvedValue(undefined)
  const state = {
    moments: { isOperationPending: () => overrides.isOperationPending ?? false },
    notes: { deleteNote },
  } as unknown as AppStateValue
  return { state, deleteNote }
}

describe('canvasApi note.delete', () => {
  it('deletes the note by id through the notes state, keyed to the panel that dispatched it', async () => {
    const shape = makeShape('notes', 'panel-notes')
    const { state, deleteNote } = fakeState()
    const api = createCanvasApi(editorWith(shape), () => state)

    await api.dispatch({ kind: 'note.delete', panelId: 'panel-notes', noteId: 'note-1' })

    expect(deleteNote).toHaveBeenCalledWith('note-1', 'panel-notes')
  })

  it('rejects when the panel does not exist on the canvas, without calling deleteNote', async () => {
    const { state, deleteNote } = fakeState()
    const api = createCanvasApi(editorWith(), () => state)

    await expect(api.dispatch({ kind: 'note.delete', panelId: 'missing-panel', noteId: 'note-1' })).rejects.toThrow(
      'No panel has the id "missing-panel".',
    )
    expect(deleteNote).not.toHaveBeenCalled()
  })

  it('rejects while a moment operation is pending, without calling deleteNote', async () => {
    const shape = makeShape('notes', 'panel-notes')
    const { state, deleteNote } = fakeState({ isOperationPending: true })
    const api = createCanvasApi(editorWith(shape), () => state)

    await expect(api.dispatch({ kind: 'note.delete', panelId: 'panel-notes', noteId: 'note-1' })).rejects.toThrow(
      'Please wait for the current moment operation to finish.',
    )
    expect(deleteNote).not.toHaveBeenCalled()
  })
})
