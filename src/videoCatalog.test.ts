import { describe, expect, it } from 'vitest'
import {
  createVideoCatalog,
  enabledVideoCatalogItems,
  isCanonicalInstagramProfileUrl,
  isCanonicalInstagramVideoUrl,
  resolveVideoCatalogItem,
  validateVideoCatalogItem,
  videoCatalog,
  videoCatalogErrors,
} from './videoCatalog'

describe('curated video catalogue', () => {
  it('accepts only canonical public-post and Reel URL shapes on Instagram HTTPS', () => {
    expect(isCanonicalInstagramVideoUrl('https://www.instagram.com/reel/Abc_123-/')).toBe(true)
    expect(isCanonicalInstagramVideoUrl('https://www.instagram.com/p/Abc_123-/')).toBe(true)
    expect(isCanonicalInstagramVideoUrl('http://www.instagram.com/reel/Abc/')).toBe(false)
    expect(isCanonicalInstagramVideoUrl('https://instagram.com/reel/Abc/')).toBe(false)
    expect(isCanonicalInstagramVideoUrl('https://www.instagram.com/reel/Abc/?utm_source=user')).toBe(false)
    expect(isCanonicalInstagramVideoUrl('https://www.instagram.com/stories/Abc/')).toBe(false)
    expect(isCanonicalInstagramVideoUrl('https://www.instagram.com.evil.example/reel/Abc/')).toBe(false)
  })

  it('requires a canonical Instagram profile URL matching the creator name', () => {
    expect(isCanonicalInstagramProfileUrl('https://www.instagram.com/creator.name/', 'creator.name')).toBe(true)
    expect(isCanonicalInstagramProfileUrl('https://www.instagram.com/another_creator/', 'creator.name')).toBe(false)
    expect(isCanonicalInstagramProfileUrl('https://instagram.com/creator.name/', 'creator.name')).toBe(false)
    expect(isCanonicalInstagramProfileUrl('https://www.instagram.com/creator.name/?hl=en', 'creator.name')).toBe(false)
  })

  it('rejects malformed entries, unsupported providers, and duplicate ids', () => {
    const valid = {
      id: 'one',
      provider: 'instagram',
      title: 'One',
      creator: 'creator.one',
      creatorUrl: 'https://www.instagram.com/creator.one/',
      sourceUrl: 'https://www.instagram.com/reel/One/',
      enabled: true,
    }
    expect(validateVideoCatalogItem(valid)).toEqual(valid)
    expect(validateVideoCatalogItem({ ...valid, provider: 'youtube' })).toBeNull()
    expect(validateVideoCatalogItem({ ...valid, creatorUrl: 'https://www.instagram.com/someone_else/' })).toBeNull()
    expect(validateVideoCatalogItem({ ...valid, sourceUrl: 'https://example.com/video' })).toBeNull()

    const result = createVideoCatalog([valid, { ...valid }, { ...valid, id: 'bad', sourceUrl: 'javascript:alert(1)' }])
    expect(result.items).toEqual([valid])
    expect(result.errors).toHaveLength(2)
  })

  it('resolves enabled items and preserves disabled or removed selections as unavailable', () => {
    const attribution = { creator: 'creator', creatorUrl: 'https://www.instagram.com/creator/' }
    const enabled = { id: 'enabled', provider: 'instagram' as const, title: 'Enabled', ...attribution, sourceUrl: 'https://www.instagram.com/reel/Enabled/', enabled: true }
    const disabled = { id: 'disabled', provider: 'instagram' as const, title: 'Disabled', ...attribution, sourceUrl: 'https://www.instagram.com/reel/Disabled/', enabled: false }
    const catalog = [enabled, disabled]

    expect(resolveVideoCatalogItem(null, catalog)).toEqual({ status: 'none' })
    expect(resolveVideoCatalogItem('enabled', catalog)).toEqual({ status: 'available', item: enabled })
    expect(resolveVideoCatalogItem('disabled', catalog)).toEqual({ status: 'unavailable', item: disabled })
    expect(resolveVideoCatalogItem('removed', catalog)).toEqual({ status: 'unavailable' })
    expect(enabledVideoCatalogItems(catalog)).toEqual([enabled])
  })

  it('ships all four configured videos as validated, enabled catalogue records', () => {
    expect(videoCatalogErrors).toEqual([])
    expect(videoCatalog).toHaveLength(4)
    expect(enabledVideoCatalogItems()).toHaveLength(4)
    expect(videoCatalog.every((item) => validateVideoCatalogItem(item) !== null)).toBe(true)
  })
})
