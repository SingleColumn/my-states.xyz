import './test/setup'
import { describe, expect, it } from 'vitest'
import {
  createMoment,
  defaultSlideshowSettings,
  getMoment,
  getMomentAssets,
  normalizeSlideshowSettings,
  saveMoment,
  saveMomentAssets,
} from './storage'
import type { Moment, Panel } from './types'

function asset() {
  const bytes = new Uint8Array([1, 2, 3])
  return { id: 'legacy_asset', filename: 'local.png', name: 'local.png', mimeType: 'image/png', size: bytes.byteLength, lastModified: 0, width: 1, height: 1, blob: new Blob([bytes]) }
}

const slideshowOf = (moment: Moment | undefined) => moment?.legacy?.panels.find((panel): panel is Panel<'slideshow'> => panel.type === 'slideshow')

describe('persisted slideshow image sources', () => {
  it('defaults old settings from actual moment assets', () => {
    const legacy = { folderName: 'Old folder', currentIndex: 0, intervalMs: 5000, transitionMs: 450, shuffle: false, zoom: 1 }
    expect(normalizeSlideshowSettings(legacy, true).imageSource).toEqual({ type: 'session-assets' })
    expect(normalizeSlideshowSettings(legacy, false).imageSource).toEqual({ type: 'none' })
  })

  it('restores an old stored moment with local assets as moment-assets', async () => {
    const moment = await createMoment('Legacy local images')
    await saveMomentAssets(moment.id, [asset()])
    const slideshow = slideshowOf(moment)!
    const panels = moment.legacy!.panels.map((panel) => panel.id === slideshow.id ? { ...panel, config: { ...slideshow.config, imageSource: undefined } } : panel)
    await saveMoment({ ...moment, legacy: { panels: panels as unknown as Panel[], canvas: null } })
    expect(slideshowOf(await getMoment(moment.id))?.config.imageSource).toEqual({ type: 'session-assets' })
  })

  it('persists bundled references without writing bundled image assets', async () => {
    const moment = await createMoment('Bundled sample')
    const panels = moment.legacy!.panels.map((panel) => panel.type === 'slideshow' ? { ...panel, config: { ...defaultSlideshowSettings, folderName: 'teemu-jpeg', imageSource: { type: 'bundled' as const, collectionId: 'teemu-jpeg' } } } : panel)
    await saveMoment({ ...moment, legacy: { panels: panels as Panel[], canvas: null } })
    expect(slideshowOf(await getMoment(moment.id))?.config.imageSource).toEqual({ type: 'bundled', collectionId: 'teemu-jpeg' })
    expect(await getMomentAssets(moment.id)).toEqual([])
  })
})
