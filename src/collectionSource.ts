import { useEffect, useState } from 'react'
import { loadBundledCollections, type CollectionSummary } from './imageCollections'

export interface CollectionSourceState {
  collections: CollectionSummary[]
  loading: boolean
  error: string | null
}

/**
 * Adapts today's local manifest to the state consumed by the browser. The UI
 * receives ordinary summaries and does not know how or where they were found.
 */
export function useFeaturedBundledCollections(): CollectionSourceState {
  const [state, setState] = useState<CollectionSourceState>({
    collections: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    void loadBundledCollections()
      .then((collections) => {
        if (!cancelled) setState({ collections, loading: false, error: null })
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        const error = caught instanceof Error
          ? caught.message
          : 'Image collections could not be loaded.'
        setState({ collections: [], loading: false, error })
      })
    return () => { cancelled = true }
  }, [])

  return state
}
