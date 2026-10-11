import { useEffect, useState } from 'react'
import { loadBundledCollections, type CollectionSummary } from './imageCollections'
import {
  clearCuratedCollectionCache,
  configuredImageCollectionsBaseUrl,
  loadCuratedCollectionCatalog,
} from './curatedImageCollections'

export interface CollectionSourceState {
  collections: CollectionSummary[]
  loading: boolean
  error: string | null
  sourceType: 'bundled' | 'curated'
  retry(): void
}

export async function loadFeaturedImageCollections(baseUrl: string | null, fetcher: typeof fetch = fetch) {
  if (!baseUrl) return loadBundledCollections(fetcher)
  const { collections, failedCollections } = await loadCuratedCollectionCatalog(baseUrl, fetcher)
  if (!collections.length && failedCollections) throw new Error('Image collections could not be loaded. Please try again.')
  return collections
}

/**
 * Adapts today's local manifest to the state consumed by the browser. The UI
 * receives ordinary summaries and does not know how or where they were found.
 */
export function useFeaturedImageCollections(): CollectionSourceState {
  const sourceType = configuredImageCollectionsBaseUrl ? 'curated' as const : 'bundled' as const
  const [requestVersion, setRequestVersion] = useState(0)
  const [state, setState] = useState<CollectionSourceState>({
    collections: [],
    loading: true,
    error: null,
    sourceType,
    retry: () => {},
  })

  useEffect(() => {
    let cancelled = false
    setState((current) => ({ ...current, collections: [], loading: true, error: null, sourceType }))
    const request = loadFeaturedImageCollections(configuredImageCollectionsBaseUrl)
    void request
      .then((collections) => {
        if (!cancelled) setState((current) => ({ ...current, collections, loading: false, error: null, sourceType }))
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        const error = caught instanceof Error
          ? caught.message
          : 'Image collections could not be loaded.'
        setState((current) => ({ ...current, collections: [], loading: false, error, sourceType }))
      })
    return () => { cancelled = true }
  }, [requestVersion, sourceType])

  return {
    ...state,
    retry: () => {
      if (configuredImageCollectionsBaseUrl) clearCuratedCollectionCache(configuredImageCollectionsBaseUrl)
      setRequestVersion((value) => value + 1)
    },
  }
}
