import './test/setup'
import { describe, expect, it } from 'vitest'
import {
  createSession,
  defaultSlideshowSettings,
  getSession,
  getSessionAssets,
  normalizeSlideshowSettings,
  saveSession,
  saveSessionAssets,
} from './storage'
import type { Session } from './types'

function asset() {
  const bytes = new Uint8Array([1, 2, 3])
  return { id: 'legacy_asset', filename: 'local.png', name: 'local.png', mimeType: 'image/png', size: bytes.byteLength, lastModified: 0, width: 1, height: 1, blob: new Blob([bytes]) }
}

describe('persisted slideshow image sources', () => {
  it('defaults old settings from actual session assets', () => {
    const legacy = { folderName: 'Old folder', currentIndex: 0, intervalMs: 5000, transitionMs: 450, shuffle: false, zoom: 1 }
    expect(normalizeSlideshowSettings(legacy, true).imageSource).toEqual({ type: 'session-assets' })
    expect(normalizeSlideshowSettings(legacy, false).imageSource).toEqual({ type: 'none' })
  })

  it('restores an old stored session with local assets as session-assets', async () => {
    const session = await createSession('Legacy local images')
    await saveSessionAssets(session.id, [asset()])
    const legacySession = { ...session, slideshow: { ...session.slideshow, imageSource: undefined } } as unknown as Session
    await saveSession(legacySession)
    expect((await getSession(session.id))?.slideshow.imageSource).toEqual({ type: 'session-assets' })
  })

  it('persists bundled references without writing bundled image assets', async () => {
    const session = await createSession('Bundled sample')
    await saveSession({ ...session, slideshow: { ...defaultSlideshowSettings, folderName: 'teemu-jpeg', imageSource: { type: 'bundled', collectionId: 'teemu-jpeg' } } })
    expect((await getSession(session.id))?.slideshow.imageSource).toEqual({ type: 'bundled', collectionId: 'teemu-jpeg' })
    expect(await getSessionAssets(session.id)).toEqual([])
  })
})
