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
import type { Moment } from './types'

function asset() {
  const bytes = new Uint8Array([1, 2, 3])
  return { id: 'legacy_asset', filename: 'local.png', name: 'local.png', mimeType: 'image/png', size: bytes.byteLength, lastModified: 0, width: 1, height: 1, blob: new Blob([bytes]) }
}

describe('persisted slideshow image sources', () => {
  it('defaults old settings from actual moment assets', () => {
    const legacy = { folderName: 'Old folder', currentIndex: 0, intervalMs: 5000, transitionMs: 450, shuffle: false, zoom: 1 }
    expect(normalizeSlideshowSettings(legacy, true).imageSource).toEqual({ type: 'session-assets' })
    expect(normalizeSlideshowSettings(legacy, false).imageSource).toEqual({ type: 'none' })
  })

  it('restores an old stored moment with local assets as moment-assets', async () => {
    const moment = await createMoment('Legacy local images')
    await saveMomentAssets(moment.id, [asset()])
    const slideshow = moment.panels.find((panel) => panel.type === 'slideshow')!
    const legacyMoment = { ...moment, panels: moment.panels.map((panel) => panel.id === slideshow.id ? { ...panel, config: { ...slideshow.config, imageSource: undefined } } : panel) } as unknown as Moment
    await saveMoment(legacyMoment)
    expect((await getMoment(moment.id))?.panels.find((panel) => panel.type === 'slideshow')?.config.imageSource).toEqual({ type: 'session-assets' })
  })

  it('persists bundled references without writing bundled image assets', async () => {
    const moment = await createMoment('Bundled sample')
    await saveMoment({ ...moment, panels: moment.panels.map((panel) => panel.type === 'slideshow' ? { ...panel, config: { ...defaultSlideshowSettings, folderName: 'teemu-jpeg', imageSource: { type: 'bundled', collectionId: 'teemu-jpeg' } } } : panel) })
    expect((await getMoment(moment.id))?.panels.find((panel) => panel.type === 'slideshow')?.config.imageSource).toEqual({ type: 'bundled', collectionId: 'teemu-jpeg' })
    expect(await getMomentAssets(moment.id)).toEqual([])
  })
})
