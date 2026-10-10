import type { VideoCatalogItem } from '../videoCatalog'
import { InstagramVideoEmbed } from './InstagramVideoEmbed'

/** Provider-specific rendering stays behind this boundary. */
export function VideoProvider({ item }: { item: VideoCatalogItem }) {
  switch (item.provider) {
    case 'instagram':
      return <InstagramVideoEmbed item={item} />
    default: {
      const unsupported: never = item.provider
      throw new Error(`Unsupported video provider: ${String(unsupported)}`)
    }
  }
}
