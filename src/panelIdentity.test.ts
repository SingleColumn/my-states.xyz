import './test/setup'
import { describe, expect, it } from 'vitest'
import { createBoard, getBoard } from './storage'
import { draftFromDocument } from './panelStore'
import type { Board } from './types'

const panelIdsOf = (board: Board) => draftFromDocument(board.document, board.camera).panels.map((panel) => panel.id)

describe('persistent panel identity', () => {
  it('assigns stable IDs and preserves them across reloads', async () => {
    const created = await createBoard('Stable IDs')
    const ids = panelIdsOf(created)
    const reloaded = await getBoard(created.id)
    expect(reloaded && panelIdsOf(reloaded)).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the panel id as the key the other stores use, alongside the shape id', () => {
    const shape = { type: 'music-panel', props: { panelId: 'panel-notes', w: 460, h: 720, panel: { type: 'notes', config: { activeNoteId: null } }, visible: true, focusView: false } }
    expect(shape.props.panelId).toBe('panel-notes')
  })
})
