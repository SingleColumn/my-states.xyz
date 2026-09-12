import type { ImageItem, SlideshowSettings } from './types'
import { DEFAULT_SLIDESHOW_ZOOM } from './storage'

export function settingsForMomentAssets(settings: SlideshowSettings, folderName: string): SlideshowSettings {
  return { ...settings, folderName, imageSource: { type: 'session-assets' }, currentIndex: 0 }
}

export function settingsForBundledCollection(settings: SlideshowSettings, collectionId: string): SlideshowSettings {
  return { ...settings, folderName: collectionId, imageSource: { type: 'bundled', collectionId }, currentIndex: 0 }
}

export function settingsForClearedImages(settings: SlideshowSettings): SlideshowSettings {
  return { ...settings, folderName: null, imageSource: { type: 'none' }, currentIndex: 0, zoom: DEFAULT_SLIDESHOW_ZOOM }
}

export function statusForImageSource(source: SlideshowSettings['imageSource'], imageCount: number) {
  if (source.type === 'bundled') {
    return imageCount
      ? `${source.collectionId} · ${imageCount} images`
      : `No images are available yet in "${source.collectionId}".`
  }
  return imageCount ? `${imageCount} images loaded from this moment.` : 'No supported images are available.'
}

export function releaseImageItems(images: ImageItem[]) {
  for (const image of images) {
    if (image.urlKind === 'object-url') URL.revokeObjectURL(image.url)
  }
}
