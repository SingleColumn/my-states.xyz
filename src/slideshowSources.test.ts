import { describe, expect, it, vi } from 'vitest'
import { defaultSlideshowSettings } from './storage'
import {
  releaseImageItems,
  settingsForBundledCollection,
  settingsForClearedImages,
  settingsForSessionAssets,
  statusForImageSource,
} from './slideshowSources'
import type { ImageItem } from './types'

describe('slideshow image source transitions', () => {
  it('switches local → bundled → bundled → local while preserving playback settings', () => {
    const local = settingsForSessionAssets({ ...defaultSlideshowSettings, intervalMs: 900, transitionMs: 1200, shuffle: true, zoom: 1.6, currentIndex: 8 }, 'Local folder')
    const firstSample = settingsForBundledCollection(local, 'teemu-jpeg')
    const secondSample = settingsForBundledCollection({ ...firstSample, currentIndex: 4 }, 'eightbitstrana')
    const localAgain = settingsForSessionAssets(secondSample, 'New local folder')

    expect(firstSample).toMatchObject({ imageSource: { type: 'bundled', collectionId: 'teemu-jpeg' }, currentIndex: 0 })
    expect(secondSample).toMatchObject({ imageSource: { type: 'bundled', collectionId: 'eightbitstrana' }, currentIndex: 0 })
    expect(localAgain).toMatchObject({ imageSource: { type: 'session-assets' }, folderName: 'New local folder', currentIndex: 0, intervalMs: 900, transitionMs: 1200, shuffle: true, zoom: 1.6 })
  })

  it('clears either source predictably and reports empty samples clearly', () => {
    const selected = settingsForBundledCollection(defaultSlideshowSettings, 'jaumecopilotos-ai')
    expect(settingsForClearedImages({ ...selected, currentIndex: 2, zoom: 2 })).toMatchObject({ imageSource: { type: 'none' }, folderName: null, currentIndex: 0, zoom: 1 })
    expect(statusForImageSource(selected.imageSource, 0)).toBe('No images are available yet in "jaumecopilotos-ai".')
  })

  it('revokes object URLs but never static sample URLs', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const base = { id: 'image', sessionId: null, filename: 'image.jpg', name: 'image.jpg', mimeType: 'image/jpeg', size: 0, lastModified: 0, width: null, height: null }
    releaseImageItems([
      { ...base, url: 'blob:local', urlKind: 'object-url' },
      { ...base, id: 'sample', url: '/sample-images/teemu-jpeg/image.jpg', urlKind: 'static' },
    ] as ImageItem[])
    expect(revoke).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:local')
    revoke.mockRestore()
  })
})
