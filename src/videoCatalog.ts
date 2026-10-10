import configuredVideoCatalog from './config/video-catalog.json' with { type: 'json' }

export interface VideoCatalogItem {
  id: string
  provider: 'instagram'
  title: string
  creator: string
  creatorUrl: string
  sourceUrl: string
  enabled: boolean
}

export interface VideoCatalogValidation {
  items: readonly VideoCatalogItem[]
  errors: readonly string[]
}

/** Keeps malformed source-controlled entries away from the embed renderer. */
export function createVideoCatalog(values: readonly unknown[]): VideoCatalogValidation {
  const items: VideoCatalogItem[] = []
  const errors: string[] = []
  const ids = new Set<string>()

  values.forEach((value, index) => {
    const item = validateVideoCatalogItem(value)
    if (!item) {
      errors.push(`Video catalogue entry ${index + 1} is invalid.`)
      return
    }
    if (ids.has(item.id)) {
      errors.push(`Video catalogue id "${item.id}" is duplicated.`)
      return
    }
    ids.add(item.id)
    items.push(item)
  })

  return { items, errors }
}

export function validateVideoCatalogItem(value: unknown): VideoCatalogItem | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value.id)) return null
  if (value.provider !== 'instagram') return null
  if (typeof value.title !== 'string' || !value.title.trim()) return null
  if (typeof value.creator !== 'string' || !value.creator.trim()) return null
  if (typeof value.creatorUrl !== 'string' || !isCanonicalInstagramProfileUrl(value.creatorUrl, value.creator)) return null
  if (typeof value.enabled !== 'boolean') return null
  if (typeof value.sourceUrl !== 'string' || !isCanonicalInstagramVideoUrl(value.sourceUrl)) return null
  return {
    id: value.id,
    provider: value.provider,
    title: value.title.trim(),
    creator: value.creator.trim(),
    creatorUrl: value.creatorUrl,
    sourceUrl: value.sourceUrl,
    enabled: value.enabled,
  }
}

export function isCanonicalInstagramProfileUrl(value: string, creator: string): boolean {
  try {
    const url = new URL(value)
    const match = /^\/([A-Za-z0-9._]{1,30})\/$/.exec(url.pathname)
    return url.protocol === 'https:'
      && url.hostname === 'www.instagram.com'
      && url.port === ''
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === ''
      && match?.[1].toLowerCase() === creator.trim().toLowerCase()
      && url.href === value
  } catch {
    return false
  }
}

export function isCanonicalInstagramVideoUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'www.instagram.com'
      && url.port === ''
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === ''
      && /^\/(?:p|reel)\/[A-Za-z0-9_-]+\/$/.test(url.pathname)
      && url.href === value
  } catch {
    return false
  }
}

// Administrators update the source-controlled JSON file and deploy. Keeping
// validation here means JSON is an editing convenience, not a way to bypass
// the catalogue's provider and URL restrictions.
const validatedCatalog = createVideoCatalog(configuredVideoCatalog)

/** Only validated entries can reach a provider renderer. */
export const videoCatalog = validatedCatalog.items
export const videoCatalogErrors = validatedCatalog.errors

export function enabledVideoCatalogItems(catalog: readonly VideoCatalogItem[] = videoCatalog) {
  return catalog.filter((item) => item.enabled)
}

export type VideoCatalogResolution =
  | { status: 'none' }
  | { status: 'available'; item: VideoCatalogItem }
  | { status: 'unavailable'; item?: VideoCatalogItem }

export function resolveVideoCatalogItem(
  selectedVideoId: string | null,
  catalog: readonly VideoCatalogItem[] = videoCatalog,
): VideoCatalogResolution {
  if (selectedVideoId === null) return { status: 'none' }
  const item = catalog.find((candidate) => candidate.id === selectedVideoId)
  if (
    !item
    || !item.enabled
    || item.provider !== 'instagram'
    || !isCanonicalInstagramProfileUrl(item.creatorUrl, item.creator)
    || !isCanonicalInstagramVideoUrl(item.sourceUrl)
  ) {
    return { status: 'unavailable', ...(item ? { item } : {}) }
  }
  return { status: 'available', item }
}

export function isSelectableVideoId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && resolveVideoCatalogItem(value).status === 'available')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
