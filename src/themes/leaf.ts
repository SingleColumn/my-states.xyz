/**
 * The vocabulary a theme field is declared in: what kind of CSS value it
 * takes, which custom property it drives, and how it is derived when a
 * theme leaves it out. Kept apart from tokens.ts (which assembles the whole
 * spec) so that the panel registry can declare each panel's own theme
 * fields with these same helpers without a circular import: this module
 * imports nothing.
 */

export type ValueKind = 'color' | 'background' | 'shadow' | 'filter' | 'border' | 'font' | 'stroke' | 'radius' | 'weight' | 'angle' | 'length' | 'choice'

/** Resolved values of the layers a derivation may read. */
export interface DeriveContext {
  foundation: Record<string, string | undefined>
  semantic: Record<string, string | undefined>
}

export interface LeafSpec {
  kind: ValueKind
  description: string
  token?: `--${string}`
  derive?: (context: DeriveContext) => string | null
  /** Turns the author's value into the token's value (the grid colour becomes two gradients). */
  compile?: (value: string) => string
  /** For `choice`: the names the author may pick from. */
  values?: readonly string[]
}

export interface GroupSpec {
  description: string
  fields: Record<string, LeafSpec | GroupSpec>
}

export function isGroupSpec(spec: LeafSpec | GroupSpec): spec is GroupSpec {
  return 'fields' in spec
}

/** `color-mix(in srgb, <colour> <pct>%, transparent)`: "a bit of this colour", the way the built-in theme writes its borders and controls. */
export const mix = (color: string | undefined, percent: number) => color ? `color-mix(in srgb, ${color} ${percent}%, transparent)` : null

/** Derivations: a foundation value, a semantic value, or a percentage of one. */
export const f = (name: string) => (context: DeriveContext) => context.foundation[name] ?? null
export const s = (name: string) => (context: DeriveContext) => context.semantic[name] ?? null
export const mixS = (name: string, percent: number) => (context: DeriveContext) => mix(context.semantic[name], percent)
export const mixF = (name: string, percent: number) => (context: DeriveContext) => mix(context.foundation[name], percent)

export const color = (description: string, rest: Omit<LeafSpec, 'kind' | 'description'> = {}): LeafSpec => ({ kind: 'color', description, ...rest })

/**
 * A choice among things the app ships (a grain texture, a torn-edge mask):
 * a theme cannot carry image data, so it names one and the compiled token
 * points at the stylesheet's `--<family>-<name>` definition.
 */
export const choice = (description: string, family: string, values: readonly string[], token: `--${string}`): LeafSpec => ({
  kind: 'choice', description: `${description} One of: ${values.join(', ')}.`, values, token,
  compile: (value) => `var(--${family}-${value})`,
})
