import { getPanelDefinition, isPanelType, defaultSlideshowSettings, defaultSpotifyPlaylistReference } from './panelRegistry'
import type { Panel, SlideshowSettings, SpotifyPlaylistReference } from './types'

function record(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The saved panel configuration is not an object.')
  return value as Record<string, unknown>
}

/** Copy only known keys. Missing fields get historical defaults; malformed
 * known fields are rejected, not silently replaced. The original stored
 * record is retained separately, including any unknown fields. */
function fields(defaults: object, input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, input[key] === undefined ? fallback : input[key]]))
}

export function normalizePlaylist(value: unknown): SpotifyPlaylistReference {
  const input = record(value)
  return {
    ...fields(defaultSpotifyPlaylistReference, input),
    ...(input.image !== undefined ? { image: input.image } : {}),
  } as SpotifyPlaylistReference
}

export function normalizeSlideshowSettings(value: unknown, hasMomentAssets: boolean): SlideshowSettings {
  const input = record(value)
  const source = input.imageSource === undefined
    ? { type: hasMomentAssets ? 'session-assets' : 'none' }
    : record(input.imageSource)
  const imageSource = source.type === 'bundled'
    ? { type: source.type, collectionId: source.collectionId }
    : { type: source.type }
  const config = { ...fields(defaultSlideshowSettings, input), imageSource }
  return getPanelDefinition('slideshow').configValidator.validate(config)
}

export function normalizeLegacyPanel(value: unknown, hasMomentAssets: boolean): Panel {
  const panel = record(value)
  if (!isPanelType(panel.type)) throw new Error('This moment contains an unsupported panel type. Its original data has been kept.')
  if (typeof panel.id !== 'string' || !panel.id) throw new Error('A saved panel is missing its identity.')
  for (const flag of ['visible', 'focusView']) {
    if (panel[flag] !== undefined && typeof panel[flag] !== 'boolean') throw new Error(`Invalid saved panel ${flag}.`)
  }
  const input = record(panel.config)
  const config = panel.type === 'slideshow'
    ? normalizeSlideshowSettings(input, hasMomentAssets)
    : panel.type === 'spotify'
      ? { playlist: normalizePlaylist(input.playlist) }
      : { activeNoteId: input.activeNoteId === undefined ? null : input.activeNoteId }
  getPanelDefinition(panel.type).configValidator.validate(config)
  return { ...panel, type: panel.type, config } as Panel
}
