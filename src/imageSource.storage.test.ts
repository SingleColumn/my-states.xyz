import './test/setup'
import { describe, expect, it } from 'vitest'
import {
  createDefaultPanels,
  defaultSlideshowSettings,
  getMoment,
  getMomentAssets,
  importMomentContent,
  normalizeSlideshowSettings,
} from './storage'
import type { Moment, Panel } from './types'

const slideshowOf = (moment: Moment | undefined) => moment?.draft?.panels.find((panel): panel is Panel<'slideshow'> => panel.type === 'slideshow')

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
    const moment = await importMomentContent({ name: 'Bundled sample', panels, canvas: null, notes: [], assets: [] })
    expect(slideshowOf(await getMoment(moment.id))?.config.imageSource).toEqual({ type: 'bundled', collectionId: 'teemu-jpeg' })
    expect(await getMomentAssets(moment.id)).toEqual([])
  })
})
