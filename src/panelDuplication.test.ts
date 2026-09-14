import './test/setup'
import { describe, expect, it } from 'vitest'
import { duplicatePanel } from './panelDuplication'
import { createPanel, createDefaultPanels, getMoment, importMomentContent } from './storage'
import { draftFromDocument } from './panelStore'

describe('panel duplication', () => {
  it('creates a fresh panel for each kind in the registry', () => {
    const music = createPanel('spotify')
    const images = createPanel('slideshow')
    const notes = createPanel('notes')

    expect(new Set([music.id, images.id, notes.id]).size).toBe(3)
    expect(music.type).toBe('spotify')
    expect(images.type).toBe('slideshow')
    expect(notes.type).toBe('notes')
    expect(notes).toMatchObject({ type: 'notes', config: { activeNoteId: null } })
  })

  it('gives a copy its own id and its own config object', () => {
    const source = createPanel('slideshow')
    const duplicate = duplicatePanel(source)
    if (!duplicate) throw new Error('Slideshow panel unexpectedly rejected for duplication')
    expect(duplicate.id).not.toBe(source.id)
    expect(duplicate.type).toBe(source.type)
    expect(duplicate.config).toEqual(source.config)
    expect(duplicate.config).not.toBe(source.config)
  })

  it('refuses to copy a singleton kind', () => {
    expect(duplicatePanel(createPanel('spotify'))).toBeNull()
  })

  it('keeps a copy in a moment built by import, with no canvas involved', async () => {
    const panels = createDefaultPanels()
    const source = panels.find((panel) => panel.type === 'notes')!
    const duplicate = duplicatePanel(source)
    if (!duplicate) throw new Error('Notes panel unexpectedly rejected for duplication')
    const moment = await importMomentContent({ name: 'Duplicate panels', panels: [...panels, duplicate], canvas: null, notes: [], assets: [] })
    const reloaded = await getMoment(moment.id)
    const notesPanels = reloaded ? draftFromDocument(reloaded.document, reloaded.camera).panels.filter((panel) => panel.type === 'notes') : []
    expect(notesPanels).toHaveLength(2)
    // Import reissues identities; the copy keeps its own configuration.
    expect(new Set(notesPanels.map((panel) => panel.id)).size).toBe(2)
    expect(notesPanels.map((panel) => panel.config)).toEqual([duplicate.config, duplicate.config])
  })
})
