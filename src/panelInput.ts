import { getPanelDefinition, isPanelType, defaultSlideshowSettings, defaultSpotifyPlaylistReference } from './panelRegistry'
import type { Panel, SlideshowSettings, SpotifyPlaylistReference } from './types'

/**
 * Panels that arrive from outside the canvas: an archive being imported, or
 * the defaults a new moment starts with. They are input, so they are
 * projected onto the keys the registry knows and validated before anything
 * stores them. Missing keys take the registry's defaults; a malformed known
 * value is rejected, never silently replaced.
 */

function record(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The saved panel configuration is not an object.')
  return value as Record<string, unknown>
}

/** Copy only known keys; a missing one takes its default. */
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

export function normalizeSlideshowSettings(value: unknown): SlideshowSettings {
  const input = record(value)
  const source = input.imageSource === undefined ? { type: 'none' } : record(input.imageSource)
  const imageSource = source.type === 'bundled'
    ? { type: source.type, collectionId: source.collectionId }
    : { type: source.type }
  const config = { ...fields(defaultSlideshowSettings, input), imageSource }
  return getPanelDefinition('slideshow').configValidator.validate(config)
}

export function normalizeDraftPanel(value: unknown): Panel {
  const panel = record(value)
  if (!isPanelType(panel.type)) throw new Error('This moment contains an unsupported panel type.')
  if (typeof panel.id !== 'string' || !panel.id) throw new Error('A saved panel is missing its identity.')
  for (const flag of ['visible', 'focusView']) {
    if (panel[flag] !== undefined && typeof panel[flag] !== 'boolean') throw new Error(`Invalid saved panel ${flag}.`)
  }
  const input = record(panel.config)
  // Per-type until the registry can normalise its own config (a planned
  // change); validation below is already the registry's.
  const config = panel.type === 'slideshow'
    ? normalizeSlideshowSettings(input)
    : panel.type === 'spotify'
      ? { playlist: normalizePlaylist(input.playlist) }
      : { activeNoteId: input.activeNoteId === undefined ? null : input.activeNoteId }
  getPanelDefinition(panel.type).configValidator.validate(config)
  return {
    id: panel.id,
    type: panel.type,
    config,
    visible: panel.visible === undefined ? true : panel.visible,
    focusView: panel.focusView === undefined ? false : panel.focusView,
  } as Panel
}
