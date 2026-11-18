export type PlaybackKind = 'sequential' | 'random'
export type Parameter = { id: string; label: string; type: 'range' | 'color' | 'number'; value: number | string; min?: number; max?: number; step?: number }
export interface AnimationDefinition {
  formatVersion: 1
  id: string
  name: string
  css: string
  parameters: Parameter[]
  playback: { kind: PlaybackKind; continuous: boolean }
}

export const builtInAnimations: AnimationDefinition[] = [
  {
    formatVersion: 1, id: 'sequential-reveal', name: 'Sequential Reveal',
    css: '.word { visibility: hidden; }\n.word[data-revealed="true"] { visibility: visible; }',
    parameters: [{ id: 'speed', label: 'Words per second', type: 'range', value: 4, min: 1, max: 20, step: 1 }],
    playback: { kind: 'sequential', continuous: false },
  },
  {
    formatVersion: 1, id: 'random-illumination', name: 'Random Illumination',
    css: '.word[data-illuminated="true"] { color: var(--animation-color); text-shadow: 0 0 0.65em var(--animation-color); }',
    parameters: [
      { id: 'color', label: 'Light colour', type: 'color', value: '#ffd166' },
      { id: 'intensity', label: 'Words lit at once', type: 'range', value: 3, min: 1, max: 12, step: 1 },
      { id: 'frequency', label: 'Changes per second', type: 'range', value: 3, min: 1, max: 12, step: 1 },
      { id: 'seed', label: 'Seed', type: 'number', value: 1 },
    ],
    playback: { kind: 'random', continuous: true },
  },
]

export function parameterNumber(definition: AnimationDefinition, id: string, fallback: number) {
  const value = Number(definition.parameters.find(parameter => parameter.id === id)?.value)
  return Number.isFinite(value) ? value : fallback
}

export function duplicateAnimation(definition: AnimationDefinition): AnimationDefinition {
  return { ...definition, id: `custom-${crypto.randomUUID()}`, name: `${definition.name} copy`, parameters: definition.parameters.map(parameter => ({ ...parameter })) }
}

const STORAGE_KEY = 'mic:text-animations:v1'
export function loadCustomAnimations(): AnimationDefinition[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is AnimationDefinition =>
      item?.formatVersion === 1 && typeof item.id === 'string' && item.id.startsWith('custom-') &&
      typeof item.name === 'string' && typeof item.css === 'string' && Array.isArray(item.parameters) &&
      (item.playback?.kind === 'sequential' || item.playback?.kind === 'random'))
  } catch { return [] }
}
export function saveCustomAnimations(definitions: AnimationDefinition[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(definitions))
}
