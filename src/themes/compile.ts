import type { ThemeMode } from './types'
import { componentsSpec, foundationSpec, semanticSpec, listLeaves, type DeriveContext, type LeafSpec } from './tokens'

/** The values a compiled mode sets, keyed by custom property name. */
export type CompiledTokens = Readonly<Record<string, string>>

function readPath(source: unknown, path: string): string | undefined {
  let value: unknown = source
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return typeof value === 'string' ? value : undefined
}

/** Author's value where given, otherwise the derivation; null when neither applies. */
function valueOf(spec: LeafSpec, explicit: string | undefined, context: DeriveContext): string | null {
  if (explicit !== undefined) return explicit
  return spec.derive?.(context) ?? null
}

/**
 * Turns one mode into custom-property values, layer by layer: the foundation
 * is read as given, each semantic role is the author's value or its
 * derivation from the foundation, and each component value is the author's
 * or its derivation from the two below. A value that neither the author nor
 * a derivation supplies is left out, and the stylesheet's built-in value
 * stands.
 */
export function compileThemeMode(mode: ThemeMode): CompiledTokens {
  const foundation: Record<string, string | undefined> = {}
  for (const { path } of listLeaves(foundationSpec)) {
    // Foundation names are unique across their groups (color.accent, depth.shadowLarge, ...), so derivations read them flat.
    foundation[path.split('.').pop()!] = readPath(mode.foundation, path)
  }

  const context: DeriveContext = { foundation, semantic: {} }
  for (const { path, spec } of listLeaves(semanticSpec)) {
    context.semantic[path] = valueOf(spec, readPath(mode.semantic, path), context) ?? undefined
  }

  const tokens: Record<string, string> = {}
  const emit = (spec: LeafSpec, value: string | null) => {
    if (!spec.token || value === null) return
    tokens[spec.token] = spec.compile ? spec.compile(value) : value
  }
  for (const { path, spec } of listLeaves(foundationSpec)) emit(spec, readPath(mode.foundation, path) ?? null)
  for (const { path, spec } of listLeaves(semanticSpec)) emit(spec, context.semantic[path] ?? null)
  for (const { path, spec } of listLeaves(componentsSpec)) emit(spec, valueOf(spec, readPath(mode.components, path), context))
  return tokens
}

/**
 * The root attributes a mode asks for (`data-<name>="<value>"`): choices
 * that switch a set of rules rather than one value. Only what the theme
 * names; an absent choice leaves the attribute off, which the stylesheet
 * treats as the first option.
 */
export function compileThemeAttributes(mode: ThemeMode): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {}
  for (const { path, spec } of listLeaves(componentsSpec)) {
    if (!spec.attribute) continue
    const value = readPath(mode.components, path)
    if (value !== undefined) attributes[spec.attribute] = value
  }
  return attributes
}
