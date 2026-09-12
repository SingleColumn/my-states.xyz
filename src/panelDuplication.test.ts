import './test/setup'
import { describe, expect, it } from 'vitest'
import { duplicatePanel } from './panelDuplication'
import { createPanel, createMoment, getMoment, saveMoment } from './storage'

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

  it('keeps a copy in a moment that has not yet been opened on a canvas', async () => {
    const moment = await createMoment('Duplicate panels')
    const source = moment.legacy!.panels.find((panel) => panel.type === 'notes')!
    const duplicate = duplicatePanel(source)
    if (!duplicate) throw new Error('Notes panel unexpectedly rejected for duplication')
    await saveMoment({ ...moment, legacy: { panels: [...moment.legacy!.panels, duplicate], canvas: null } })
    const reloaded = await getMoment(moment.id)
    expect(reloaded?.legacy?.panels.filter((panel) => panel.type === 'notes')).toHaveLength(2)
    expect(reloaded?.legacy?.panels.find((panel) => panel.id === duplicate.id)).toEqual(duplicate)
  })
})
