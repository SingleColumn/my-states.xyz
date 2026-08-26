import { Images } from 'lucide-react'
import { useEffect, useState } from 'react'
import { loadBundledCollectionPreviews, type BundledCollectionPreview } from '../imageCollections'

/**
 * Cover art and image counts for every sample collection, keyed by ID.
 * The manifest is fetched once per mount; a failure leaves the map empty and
 * the cards fall back to their name-only form rather than blocking onboarding.
 */
export function useSampleCollectionPreviews() {
  const [previews, setPreviews] = useState<Record<string, BundledCollectionPreview>>({})

  useEffect(() => {
    let cancelled = false
    void loadBundledCollectionPreviews()
      .then((loaded) => {
        if (cancelled) return
        setPreviews(Object.fromEntries(loaded.map((preview) => [preview.id, preview])))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return previews
}

/**
 * One sample collection, shown as a cover image credited to the creator whose
 * profile the collection is named after. `tile` stacks the cover above the
 * name for the onboarding grid; `row` puts them side by side for the picker.
 */
export function SampleCollectionCard({
  name,
  preview,
  variant,
  onSelect,
  onPointerDown,
}: {
  name: string
  preview: BundledCollectionPreview | undefined
  variant: 'tile' | 'row'
  onSelect(): void
  onPointerDown?(event: React.SyntheticEvent): void
}) {
  return (
    <button
      className={`sample-collection-card is-${variant}`}
      type="button"
      title={`Load the collection by ${name}`}
      onPointerDown={onPointerDown}
      onClick={onSelect}
    >
      <span className="sample-collection-cover">
        {preview?.coverUrl
          ? <img src={preview.coverUrl} alt="" decoding="async" draggable={false} />
          : <Images className="sample-collection-cover-fallback" aria-hidden="true" />}
      </span>
      <span className="sample-collection-text">
        <span className="sample-collection-name">{name}</span>
      </span>
    </button>
  )
}
