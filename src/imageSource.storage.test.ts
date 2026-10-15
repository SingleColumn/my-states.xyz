import './test/setup'
import { describe, expect, it } from 'vitest'
import {
  createDefaultPanels,
  defaultSlideshowSettings,
  getBoard,
  getBoardAssets,
  importBoardContent,
  normalizeSlideshowSettings,
} from './storage'
import { draftFromDocument } from './panelStore'
import type { Board, Panel } from './types'

const slideshowOf = (board: Board | undefined) => board && draftFromDocument(board.document, board.camera).panels.find((panel): panel is Panel<'slideshow'> => panel.type === 'slideshow')

describe('persisted slideshow image sources', () => {
  it('defaults a missing image source to none and fills other missing settings from the registry', () => {
    const partial = { folderName: 'Old folder', currentIndex: 0, intervalMs: 5000, transitionMs: 450, shuffle: false, zoom: 1 }
    expect(normalizeSlideshowSettings(partial)).toEqual({ ...partial, imageSource: { type: 'none' } })
    expect(normalizeSlideshowSettings({})).toEqual(defaultSlideshowSettings)
  })

  it('persists bundled references without writing bundled image assets', async () => {
    const panels = createDefaultPanels().map((panel): Panel => panel.type === 'slideshow'
      ? { ...panel, config: { ...defaultSlideshowSettings, folderName: 'teemu-jpeg', imageSource: { type: 'bundled' as const, collectionId: 'teemu-jpeg' } } }
      : panel)
    const board = await importBoardContent({ name: 'Bundled sample', panels, canvas: null, notes: [], assets: [] })
    expect(slideshowOf(await getBoard(board.id))?.config.imageSource).toEqual({ type: 'bundled', collectionId: 'teemu-jpeg' })
    expect(await getBoardAssets(board.id)).toEqual([])
  })

  it('normalizes and persists curated references without relabeling them as bundled', async () => {
    expect(normalizeSlideshowSettings({ ...defaultSlideshowSettings, imageSource: { type: 'curated', collectionSlug: 'rbnks-autumn' } }).imageSource)
      .toEqual({ type: 'curated', collectionSlug: 'rbnks-autumn' })

    const panels = createDefaultPanels().map((panel): Panel => panel.type === 'slideshow'
      ? { ...panel, config: { ...defaultSlideshowSettings, folderName: 'Autumn', imageSource: { type: 'curated' as const, collectionSlug: 'rbnks-autumn' } } }
      : panel)
    const board = await importBoardContent({ name: 'Curated selection', panels, canvas: null, notes: [], assets: [] })
    expect(slideshowOf(await getBoard(board.id))?.config).toMatchObject({
      folderName: 'Autumn',
      imageSource: { type: 'curated', collectionSlug: 'rbnks-autumn' },
    })
  })
})
