import type { ImageAttribution } from '../types'

/**
 * The credit carried by a picture from a sample collection, shown over the
 * image itself so it travels with the picture rather than sitting in panel
 * chrome that focus view hides.
 */
export function ImageAttributionOverlay({
  attribution,
  onPointerDown,
}: {
  attribution: ImageAttribution
  onPointerDown(event: React.SyntheticEvent): void
}) {
  const { creator, creatorUrl, sourceUrl } = attribution

  return (
    <div className="image-attribution panel-interactive" onPointerDown={onPointerDown}>
      <span className="image-attribution-label">Image by</span>
      {creatorUrl ? (
        <a className="image-attribution-creator is-link" href={creatorUrl} target="_blank" rel="noreferrer noopener">{creator}</a>
      ) : (
        <span className="image-attribution-creator">{creator}</span>
      )}
      {sourceUrl ? (
        <a className="image-attribution-source" href={sourceUrl} target="_blank" rel="noreferrer noopener">View original</a>
      ) : null}
    </div>
  )
}
