import { Images } from 'lucide-react'
import { useEffect, useState } from 'react'
import { loadBundledCollections, type BundledCollection } from '../imageCollections'

/**
 * Every sample collection, with its title and cover art. The manifest is
 * fetched once per mount; a failure leaves the list empty so onboarding falls
 * back to the folder button rather than blocking on the network.
 */
export function useBundledCollections() {
  const [collections, setCollections] = useState<BundledCollection[]>([])

  useEffect(() => {
    let cancelled = false
    void loadBundledCollections()
      .then((loaded) => { if (!cancelled) setCollections(loaded) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return collections
}

/**
 * One sample collection, shown as its cover art and title. A collection can
 * hold work from several creators, so the credit belongs on each picture
 * rather than here. `tile` stacks cover above title for the onboarding grid;
 * `row` puts them side by side for the picker.
 */
export function SampleCollectionCard({
  collection,
  variant,
  onSelect,
  onPointerDown,
}: {
  collection: BundledCollection
  variant: 'tile' | 'row'
  onSelect(): void
  onPointerDown?(event: React.SyntheticEvent): void
}) {
  return (
    <button
      className={`sample-collection-card is-${variant}`}
      type="button"
      title={`Load the ${collection.title} collection`}
      onPointerDown={onPointerDown}
      onClick={onSelect}
    >
      <span className="sample-collection-cover">
        {collection.coverUrl
          ? <img src={collection.coverUrl} alt="" decoding="async" draggable={false} />
          : <Images className="sample-collection-cover-fallback" aria-hidden="true" />}
      </span>
      <span className="sample-collection-text">
        <span className="sample-collection-name">{collection.title}</span>
      </span>
    </button>
  )
}
